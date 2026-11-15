import { winner, type Answer, type QuestionVotes, type Team } from "../game/scoring";

export interface Env {
  DB: D1Database;
  VOTER_HASH_SECRET: string;
  ASSETS: Fetcher;
}

interface QuestionRow {
  id: string;
  prompt: string;
  criteria: string;
  opens_at: string;
  closes_at: string;
  status: string;
  outcome: Answer | null;
  source_url: string | null;
  resolved_at: string | null;
}

interface VoteRow {
  team: Team;
  answer: Answer;
  count: number;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function isAnswer(value: unknown): value is Answer {
  return value === "yes" || value === "no";
}

function isTeam(value: unknown): value is Team {
  return value === "red" || value === "blue";
}

function counts(rows: VoteRow[]): QuestionVotes {
  const result: QuestionVotes = { red: { yes: 0, no: 0 }, blue: { yes: 0, no: 0 } };
  for (const row of rows) result[row.team][row.answer] = row.count;
  return result;
}

async function hashVoter(secret: string, identifier: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identifier));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function questionResult(env: Env, question: QuestionRow) {
  const rows = await env.DB.prepare(
    "SELECT team, answer, COUNT(*) AS count FROM votes WHERE question_id = ? GROUP BY team, answer",
  ).bind(question.id).all<VoteRow>();
  const votes = counts(rows.results);
  return {
    id: question.id,
    prompt: question.prompt,
    criteria: question.criteria,
    opensAt: question.opens_at,
    closesAt: question.closes_at,
    status: question.status,
    outcome: question.outcome,
    sourceUrl: question.source_url,
    resolvedAt: question.resolved_at,
    votes,
    winner: question.status === "resolved" && question.outcome ? winner(votes, question.outcome) : null,
  };
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const now = new Date().toISOString();
  if (request.method === "GET" && url.pathname === "/api/game") {
    const questions = await env.DB.prepare(
      "SELECT * FROM questions ORDER BY opens_at DESC LIMIT 50",
    ).all<QuestionRow>();
    const visible = questions.results.filter((q) => q.opens_at <= now);
    const entries = await Promise.all(visible.map((q) => questionResult(env, q)));
    const scores = { red: 0, blue: 0 };
    for (const entry of entries) {
      if (entry.winner === "red" || entry.winner === "blue") scores[entry.winner]++;
    }
    return json({ questions: entries, scores });
  }

  const match = /^\/api\/questions\/([a-zA-Z0-9_-]{1,80})\/vote$/.exec(url.pathname);
  if (request.method === "POST" && match) {
    if (!env.VOTER_HASH_SECRET || env.VOTER_HASH_SECRET.length < 32) {
      return json({ error: "Voting is not configured" }, 503);
    }
    if (Number(request.headers.get("content-length")) > 2048) {
      return json({ error: "Request too large" }, 413);
    }
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object") return json({ error: "Invalid vote" }, 400);
    const { team, answer, voterId } = body as Record<string, unknown>;
    if (!isTeam(team) || !isAnswer(answer) || typeof voterId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(voterId)) return json({ error: "Invalid vote" }, 400);

    const question = await env.DB.prepare("SELECT * FROM questions WHERE id = ?")
      .bind(match[1]).first<QuestionRow>();
    if (!question) return json({ error: "Question not found" }, 404);
    if (question.status !== "open" || question.opens_at > now || question.closes_at <= now) {
      return json({ error: "Voting is closed" }, 409);
    }
    const voterHash = await hashVoter(env.VOTER_HASH_SECRET, voterId);
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO votes (question_id, voter_hash, team, answer) VALUES (?, ?, ?, ?)",
    ).bind(question.id, voterHash, team, answer).run();
    if (inserted.meta.changes === 0) return json({ error: "Already voted on this question" }, 409);
    return json({ accepted: true, question: await questionResult(env, question) }, 201);
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      try { return await handleApi(request, env); }
      catch (error) {
        console.error("API request failed", error);
        return json({ error: "Service temporarily unavailable" }, 503);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
