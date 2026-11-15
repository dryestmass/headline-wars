import { runEditorialJob } from "./editorial";
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

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runEditorialJob(env.DB, controller.cron, controller.scheduledTime);
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/dev-publish-bls" && request.method === "POST" &&
      new URL(request.url).hostname === "dev-headline-wars.dryestmass.workers.dev" &&
      await hashVoter("headline-wars-dev-publish", request.headers.get("X-Dev-Publish") ?? "") === "759c1c99195cef73dbe33a5c94637e2afd8b3d29c7ce1870ba2417013163e6a3") {
      await env.DB.prepare(`
        INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
        SELECT 'bls-import-prices-2026-10', ?, ?, '2026-11-17T00:00:00.000Z', '2026-11-17T13:25:00.000Z'
        WHERE NOT EXISTS (SELECT 1 FROM questions WHERE id = 'bls-import-prices-2026-10')
      `).bind(
        "Did U.S. import prices rise in October?",
        "YES if the Bureau of Labor Statistics first reports that all U.S. import prices increased from September to October 2026. NO if the initially reported month-over-month change was zero or negative. Use the all-imports figure in the October U.S. Import and Export Price Indexes news release scheduled for November 17. Leave pending if the release is delayed or the figure is unavailable.",
      ).run();
      const scheduled = await env.DB.prepare("SELECT id, opens_at, closes_at, status FROM questions WHERE id = 'bls-import-prices-2026-10'").first();
      return json({ scheduled }, 201);
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
