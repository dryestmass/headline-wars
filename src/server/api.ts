import type { Ballot, Game, Question } from "../game/model";
import { winner, type Answer, type Team } from "../game/scoring";

export interface Env {
  DB: D1Database;
  VOTER_HASH_SECRET?: string;
  ASSETS: Fetcher;
}

interface QuestionRow {
  id: string;
  prompt: string;
  criteria: string;
  closes_at: string;
  status: Question["status"];
  outcome: Answer | null;
  source_url: string | null;
  red_yes: number;
  red_no: number;
  blue_yes: number;
  blue_no: number;
  voter_team: Team | null;
  voter_answer: Answer | null;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function voterId(request: Request): string | null {
  const id = request.headers.get("X-Voter-Id");
  return id && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) ? id : null;
}

async function hashVoter(secret: string, identifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(identifier));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readGame(db: D1Database, hash: string, votingEnabled: boolean, now: string): Promise<Game> {
  const { results } = await db.prepare(`
    SELECT q.id, q.prompt, q.criteria, q.closes_at, q.status, q.outcome, q.source_url,
      COUNT(CASE WHEN v.team = 'red' AND v.answer = 'yes' THEN 1 END) AS red_yes,
      COUNT(CASE WHEN v.team = 'red' AND v.answer = 'no' THEN 1 END) AS red_no,
      COUNT(CASE WHEN v.team = 'blue' AND v.answer = 'yes' THEN 1 END) AS blue_yes,
      COUNT(CASE WHEN v.team = 'blue' AND v.answer = 'no' THEN 1 END) AS blue_no,
      MAX(CASE WHEN v.voter_hash = ?1 THEN v.team END) AS voter_team,
      MAX(CASE WHEN v.voter_hash = ?1 THEN v.answer END) AS voter_answer
    FROM questions q LEFT JOIN votes v ON v.question_id = q.id
    WHERE q.opens_at <= ?2 AND q.status <> 'void'
    GROUP BY q.id
    ORDER BY q.opens_at DESC, q.id DESC
  `).bind(hash, now).all<QuestionRow>();

  const game: Game = { questions: [], scores: { red: 0, blue: 0 }, votingEnabled };
  let archived = 0;
  for (const row of results) {
    const status = row.status === "open" && row.closes_at <= now ? "closed" : row.status;
    const votes = {
      red: { yes: row.red_yes, no: row.red_no },
      blue: { yes: row.blue_yes, no: row.blue_no },
    };
    const winningTeam = status === "resolved" && row.outcome ? winner(votes, row.outcome) : null;
    if (winningTeam === "red" || winningTeam === "blue") game.scores[winningTeam]++;
    if (status === "resolved" && archived++ >= 50) continue;
    game.questions.push({
      id: row.id, prompt: row.prompt, criteria: row.criteria, closesAt: row.closes_at,
      status, outcome: row.outcome, sourceUrl: row.source_url, votes, winner: winningTeam,
      ballot: row.voter_team && row.voter_answer ? { team: row.voter_team, answer: row.voter_answer } : null,
    });
  }
  return game;
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const secret = env.VOTER_HASH_SECRET ?? "";
  const votingEnabled = secret.length >= 32;
  const id = voterId(request);
  if (request.method === "GET" && path === "/api/game") {
    const hash = id && votingEnabled ? await hashVoter(secret, id) : "";
    return json(await readGame(env.DB, hash, votingEnabled, new Date().toISOString()));
  }

  const match = /^\/api\/questions\/([a-zA-Z0-9_-]{1,80})\/vote$/.exec(path);
  if (request.method !== "POST" || !match) return json({ error: "Not found" }, 404);
  if (!votingEnabled) return json({ error: "Voting is temporarily unavailable" }, 503);
  if (!id) return json({ error: "Invalid browser voter ID" }, 400);

  if (Number(request.headers.get("content-length")) > 1024) {
    return json({ error: "Request too large" }, 413);
  }
  let body: Partial<Ballot> | null;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }
  if ((body?.team !== "red" && body?.team !== "blue") ||
      (body.answer !== "yes" && body.answer !== "no")) {
    return json({ error: "Invalid vote" }, 400);
  }

  const questionId = match[1];
  const hash = await hashVoter(secret, id);
  // SQLite checks the voting window as part of the same statement that inserts the ballot.
  const [insert, stored, question] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO votes (question_id, voter_hash, team, answer)
      SELECT id, ?2, ?3, ?4 FROM questions
      WHERE id = ?1 AND status = 'open'
        AND opens_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND closes_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ON CONFLICT(question_id, voter_hash) DO NOTHING
    `).bind(questionId, hash, body.team, body.answer),
    env.DB.prepare("SELECT team, answer FROM votes WHERE question_id = ? AND voter_hash = ?").bind(questionId, hash),
    env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(questionId),
  ]);
  const ballot = stored.results[0] as Ballot | undefined;
  if (!question.results.length) return json({ error: "Question not found" }, 404);
  if (!ballot) return json({ error: "Voting is closed" }, 409);
  if (ballot.team !== body.team || ballot.answer !== body.answer) {
    return json({ error: "Already voted on this question", ballot }, 409);
  }
  return json({ ballot }, insert.meta.changes ? 201 : 200);
}

async function liveSmoke(env: Env): Promise<Response> {
  const id = "dev-smoke-" + crypto.randomUUID();
  const now = Date.now();
  const path = "/api/questions/" + id + "/vote";
  const voter = crypto.randomUUID();
  const headers = { "X-Voter-Id": voter, "Content-Type": "application/json" };
  const vote = (answer: Answer) => handleApi(new Request("https://dev-headline-wars.dryestmass.workers.dev" + path, {
    method: "POST", headers, body: JSON.stringify({ team: "red", answer }),
  }), env, path);
  await env.DB.prepare("INSERT INTO questions (id,prompt,criteria,opens_at,closes_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, "Synthetic dev test", "Temporary ballot smoke test", new Date(now).toISOString(), new Date(now + 60000).toISOString()).run();
  try {
    const first = await vote("yes");
    const replay = await vote("yes");
    const change = await vote("no");
    const state = await handleApi(new Request("https://dev-headline-wars.dryestmass.workers.dev/api/game", { headers }), env, "/api/game");
    const game = await state.json<Game>();
    const fixture = game.questions.find((question) => question.id === id);
    const result = {
      accepted: first.status === 201,
      replay: replay.status === 200,
      duplicateRejected: change.status === 409,
      tallyUpdated: fixture?.votes.red.yes === 1 && fixture.votes.red.no === 0,
      ballotRestored: fixture?.ballot?.team === "red" && fixture.ballot.answer === "yes",
    };
    return json(result, Object.values(result).every(Boolean) ? 200 : 500);
  } finally {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM votes WHERE question_id = ?").bind(id),
      env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id),
    ]);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/dev-smoke" && request.method === "POST" &&
      new URL(request.url).hostname === "dev-headline-wars.dryestmass.workers.dev") {
      const supplied = request.headers.get("X-Dev-Smoke") ?? "";
      const fingerprint = await hashVoter("headline-wars-dev-smoke", supplied);
      if (fingerprint !== "6f4a77e57dd28e4198bc65e8e5d7b59d35a9b8e63f87c7ff18dd8324afd42a10") return json({ error: "Not found" }, 404);
      return liveSmoke(env);
    }
    if (pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, pathname); }
      catch (error) {
        console.error("API request failed", error);
        return json({ error: "Service temporarily unavailable" }, 503);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
