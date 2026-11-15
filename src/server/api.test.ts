import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import type { Game } from "../game/model";
import { runAutonomousCycle, type AutonomousSource } from "./autonomous";
import { EVIDENCE_REFRESH, NEWS_REFRESH, runEditorialJob } from "./editorial";
import worker, { type Env } from "./api";

let platform: PlatformProxy<Env>;
let env: Env;
const voter = crypto.randomUUID();
const otherVoter = crypto.randomUUID();
const questionId = "fixture-current";
const votePath = `/api/questions/${questionId}/vote`;

function request(path: string, id: string, body?: { team: string; answer: string }, bindings = env) {
  return worker.fetch(new Request(`https://worker.test${path}`, {
    headers: { "X-Voter-Id": id, "Content-Type": "application/json" },
    ...(body && { method: "POST", body: JSON.stringify(body) }),
  }), bindings);
}

function publish(id: string, opens: string, closes: string) {
  return env.DB.prepare("INSERT INTO questions (id, prompt, criteria, opens_at, closes_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, "Synthetic test question", "Synthetic test criteria", opens, closes).run();
}

async function applyMigrations(db: D1Database): Promise<void> {
  const schema = await readFile("migrations/0001_initial.sql", "utf8");
  await db.exec(schema.replace(/^--.*$/gm, "").split(";").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean).join(";\n"));
  const lifecycle = await readFile("migrations/0002_editorial_lifecycle.sql", "utf8");
  for (const trigger of lifecycle.split(/\nEND;/).slice(0, -1)) {
    await db.prepare(`${trigger.trim()}\nEND;`).run();
  }
}

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({ persist: false });
  env = { ...platform.env, VOTER_HASH_SECRET: crypto.randomUUID() };
  await applyMigrations(env.DB);
  const now = Date.now();
  await publish(questionId, new Date(now - 3600000).toISOString(), new Date(now + 3600000).toISOString());
  await publish("fixture-future", new Date(now + 7200000).toISOString(), new Date(now + 10800000).toISOString());
}, 30000);

afterAll(async () => { await platform?.dispose(); });

test("accepts one ballot per browser and exposes only that browser's ballot", async () => {
  const red = { team: "red", answer: "yes" };
  const blue = { team: "blue", answer: "no" };
  const concurrent = await Promise.all([request(votePath, voter, red), request(votePath, voter, red)]);
  expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
  const duplicate = await request(votePath, voter, blue);
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({ ballot: red });
  expect((await request(votePath, otherVoter, blue)).status).toBe(201);
  const { questions } = await (await request("/api/game", voter)).json<Game>();
  expect(questions.map((q: { id: string }) => q.id)).toEqual([questionId]);
  expect(questions[0]).toMatchObject({ ballot: red, votes: { red: { yes: 1, no: 0 }, blue: { yes: 0, no: 1 } } });
  expect((await (await request("/api/game", crypto.randomUUID())).json<Game>()).questions[0].ballot).toBeNull();
  const row = await env.DB.prepare("SELECT voter_hash FROM votes LIMIT 1").first<string>("voter_hash");
  expect(row).toMatch(/^[a-f0-9]{64}$/);
});

test("blocks malformed, early, expired, and unconfigured voting", async () => {
  const ballot = { team: "red", answer: "yes" };
  await publish("fixture-expired", "2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z");
  expect((await request(votePath, "invalid", ballot)).status).toBe(400);
  expect((await request(votePath, voter, { ...ballot, answer: "maybe" })).status).toBe(400);
  expect((await request("/api/questions/missing/vote", voter, ballot)).status).toBe(404);
  expect((await request("/api/questions/fixture-future/vote", voter, ballot)).status).toBe(409);
  expect((await request("/api/questions/fixture-expired/vote", voter, ballot)).status).toBe(409);
  expect((await request(votePath, voter, ballot, { ...env, VOTER_HASH_SECRET: undefined })).status).toBe(503);
  const { questions, scores } = await (await request("/api/game", voter)).json<Game>();
  expect(questions.find((q: { id: string }) => q.id === "fixture-expired")).toMatchObject({ status: "closed", winner: null });
  expect(scores).toEqual({ red: 0, blue: 0 });
});

test("requires evidence after closing and scores verified results beyond the display limit", async () => {
  const resolve = (id: string, source: string | null) => env.DB.prepare(`
    UPDATE questions SET status = 'resolved', outcome = 'yes', source_url = ?,
      resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).bind(source, id);
  const evidence = "https://example.test/synthetic-evidence";
  await expect(resolve(questionId, evidence).run()).rejects.toThrow(/Invalid question transition/);
  await expect(resolve("fixture-expired", null).run()).rejects.toThrow(/Invalid question transition/);
  await expect(publish("overlap", "2020-01-01T12:00:00.000Z", "2020-01-02T12:00:00.000Z")).rejects.toThrow(/overlap/);
  await env.DB.batch(Array.from({ length: 51 }, (_, index) => {
    const start = new Date(Date.UTC(2021, 0, index + 1)).toISOString();
    const end = new Date(Date.UTC(2021, 0, index + 2)).toISOString();
    return env.DB.prepare("INSERT INTO questions (id, prompt, criteria, opens_at, closes_at) VALUES (?, 'Fixture', 'Criteria', ?, ?)")
      .bind(`archive-${index}`, start, end);
  }));
  await env.DB.batch(Array.from({ length: 51 }, (_, index) => resolve(`archive-${index}`, evidence)));
  await env.DB.exec("INSERT INTO votes (question_id, voter_hash, team, answer) VALUES ('fixture-expired', 'fixture-red-1', 'red', 'yes'), ('fixture-expired', 'fixture-red-2', 'red', 'no'), ('fixture-expired', 'fixture-blue-1', 'blue', 'yes')");
  await resolve("fixture-expired", evidence).run();
  await expect(resolve("fixture-expired", evidence).run()).rejects.toThrow(/Invalid question transition/);
  const { questions, scores } = await (await request("/api/game", voter)).json<Game>();
  expect(questions.filter((q: { status: string }) => q.status === "resolved")).toHaveLength(50);
  expect(questions.some((q: { id: string }) => q.id === "fixture-expired")).toBe(false);
  expect(scores).toEqual({ red: 0, blue: 1 });
});

test("scheduled drafts deduplicate, wait for publication, and collect evidence without scoring", async () => {
  const draftTime = Date.parse("2024-01-01T13:00:00Z");
  const id = "fr-2024-90001";
  const news: typeof fetch = async () => Response.json({ results: [{
    document_number: "2024-90001",
    title: "Synthetic editorial fixture",
    publication_date: "2024-01-01",
    html_url: "https://www.federalregister.gov/documents/synthetic-editorial-fixture",
    docket_ids: ["Docket No. FAA-2024-10000"],
  }] });
  await runEditorialJob(env.DB, NEWS_REFRESH, draftTime, news);
  await runEditorialJob(env.DB, NEWS_REFRESH, draftTime + 86400000, news);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM question_drafts").first("count")).toBe(1);
  expect(await env.DB.prepare("SELECT id FROM questions WHERE id = ?").bind(id).first()).toBeNull();

  let calls = 0;
  const evidence: typeof fetch = async (input) => {
    calls++;
    expect(new URL(String(input)).searchParams.get("conditions[docket_id]")).toBe("FAA-2024-10000");
    return Response.json({ count: 0 });
  };
  const due = Date.parse("2024-04-02T13:30:00Z");
  await runEditorialJob(env.DB, EVIDENCE_REFRESH, due, evidence);
  expect(calls).toBe(0);
  await env.DB.prepare(`
    INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
    SELECT id, json_extract(draft_json, '$.prompt'), json_extract(draft_json, '$.criteria'),
           json_extract(draft_json, '$.opensAt'), json_extract(draft_json, '$.closesAt')
    FROM question_drafts WHERE id = ?
  `).bind(id).run();
  await runEditorialJob(env.DB, EVIDENCE_REFRESH, draftTime + 3 * 86400000, evidence);
  expect(calls).toBe(0);
  await runEditorialJob(env.DB, EVIDENCE_REFRESH, due, evidence);
  await runEditorialJob(env.DB, EVIDENCE_REFRESH, due + 3600000, evidence);
  expect(calls).toBe(1);
  const saved = await env.DB.prepare("SELECT evidence_json FROM question_drafts WHERE id = ?")
    .bind(id).first<string>("evidence_json");
  expect(JSON.parse(saved!)).toMatchObject({ count: 0, candidates: [] });
  const game = await (await request("/api/game", voter)).json<Game>();
  expect(game.questions.find((question) => question.id === id)).toMatchObject({
    status: "closed", outcome: null, winner: null,
  });
});

test("runs discovery, approval, voting, evidence, and scoring as one lifecycle", async () => {
  const isolated = await getPlatformProxy<Env>({ persist: false });
  const bindings = { ...isolated.env, VOTER_HASH_SECRET: crypto.randomUUID() };
  const db = bindings.DB;
  const id = "fr-2024-91001";
  const voteUrl = `/api/questions/${id}/vote`;
  const redVoter = crypto.randomUUID();
  const blueVoter = crypto.randomUUID();
  const evidenceUrl = "https://www.federalregister.gov/documents/synthetic-final-rule";
  const game = async () => (await request("/api/game", redVoter, undefined, bindings)).json<Game>();
  try {
    await applyMigrations(db);
    await runEditorialJob(db, NEWS_REFRESH, Date.parse("2024-01-01T13:00:00Z"), async () =>
      Response.json({ results: [{
        document_number: "2024-91001",
        title: "Synthetic full-cycle proposal",
        publication_date: "2024-01-01",
        html_url: "https://www.federalregister.gov/documents/synthetic-proposal",
        docket_ids: ["Docket No. FAA-2024-10000"],
      }] }));
    expect((await game()).questions).toEqual([]);

    const opens = new Date(Date.now() - 1000).toISOString();
    const closeTime = Date.now() + 5000;
    const closes = new Date(closeTime).toISOString();
    await db.prepare(`
      INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
      SELECT id, json_extract(draft_json, '$.prompt'), 'Synthetic shortened test window', ?, ?
      FROM question_drafts WHERE id = ?
    `).bind(opens, closes, id).run();
    expect((await game()).questions[0]).toMatchObject({ id, status: "open" });
    expect((await request(voteUrl, redVoter, { team: "red", answer: "yes" }, bindings)).status).toBe(201);
    expect((await request(voteUrl, blueVoter, { team: "blue", answer: "no" }, bindings)).status).toBe(201);
    expect((await game()).questions[0]).toMatchObject({
      votes: { red: { yes: 1, no: 0 }, blue: { yes: 0, no: 1 } },
      ballot: { team: "red", answer: "yes" },
    });

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, closeTime - Date.now() + 50)));
    expect((await game()).questions[0]).toMatchObject({ status: "closed", outcome: null });
    expect((await request(voteUrl, crypto.randomUUID(), { team: "red", answer: "yes" }, bindings)).status).toBe(409);
    await runEditorialJob(db, EVIDENCE_REFRESH, Date.now(), async () =>
      Response.json({ count: 1, results: [{ html_url: evidenceUrl, docket_ids: ["FAA-2024-10000"] }] }));
    const storedEvidence = await db.prepare("SELECT evidence_json FROM question_drafts WHERE id = ?")
      .bind(id).first<string>("evidence_json");
    expect(JSON.parse(storedEvidence!)).toMatchObject({ count: 1, candidates: [{ html_url: evidenceUrl }] });
    expect((await game()).scores).toEqual({ red: 0, blue: 0 });

    await db.prepare(`
      UPDATE questions SET status = 'resolved', outcome = 'yes', source_url = ?,
        resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status IN ('open', 'closed')
    `).bind(evidenceUrl, id).run();
    const verified = await game();
    expect(verified.questions[0]).toMatchObject({
      status: "resolved", outcome: "yes", sourceUrl: evidenceUrl, winner: "red",
    });
    expect(verified.scores).toEqual({ red: 1, blue: 0 });
    expect((await game()).scores).toEqual({ red: 1, blue: 0 });
  } finally {
    await isolated.dispose();
  }
}, 30000);

test("the autonomous sequence rotates the daily question and verifies a pending one only when due", async () => {
  const isolated = await getPlatformProxy<Env>({ persist: false });
  const db = isolated.env.DB;
  const first = { id: "rotation-first", prompt: "Synthetic first question", criteria: "Synthetic evidence",
    decisionAt: "2024-05-02T15:00:00.000Z" };
  const second = { ...first, id: "rotation-second", prompt: "Synthetic second question",
    decisionAt: "2024-05-03T15:00:00.000Z" };
  const sourceUrl = "https://example.test/official-fixture";
  let evidenceAvailable = false;
  let evidenceChecks = 0;
  const source: AutonomousSource = {
    discover: async (now) => now.getUTCDate() === 1 ? [first] : [first, second],
    verify: async () => {
      evidenceChecks++;
      return evidenceAvailable ? { outcome: "yes", sourceUrl } : null;
    },
  };
  const dayOne = Date.parse("2024-05-01T13:00:00Z");
  const dayTwo = Date.parse("2024-05-02T13:00:00Z");
  const due = Date.parse(first.decisionAt);
  const phase = (id: string, time: number) => db.prepare(`
    SELECT CASE WHEN status = 'open' AND closes_at <= ? THEN 'closed' ELSE status END AS phase
    FROM questions WHERE id = ?
  `).bind(new Date(time).toISOString(), id).first("phase");

  try {
    await applyMigrations(db);
    await runAutonomousCycle(db, source, dayOne);
    await runAutonomousCycle(db, source, dayOne);
    expect(await phase(first.id, dayOne)).toBe("open");
    await db.prepare("INSERT INTO votes (question_id, voter_hash, team, answer) VALUES (?, 'fixture-red', 'red', 'yes')")
      .bind(first.id).run();
    await runAutonomousCycle(db, source, dayTwo);
    expect(await phase(first.id, dayTwo)).toBe("closed");
    expect(await phase(second.id, dayTwo)).toBe("open");

    await runAutonomousCycle(db, source, due - 1);
    expect(evidenceChecks).toBe(0);
    await runAutonomousCycle(db, source, due);
    expect(await phase(first.id, due)).toBe("closed");
    evidenceAvailable = true;
    await runAutonomousCycle(db, source, due + 60000);
    await runAutonomousCycle(db, source, due + 60000);
    expect(evidenceChecks).toBe(2);

    const result = await (await request("/api/game", voter, undefined, isolated.env)).json<Game>();
    expect(result.questions.find((question) => question.id === first.id)).toMatchObject({
      status: "resolved", outcome: "yes", sourceUrl, winner: "red",
    });
    expect(result.scores).toEqual({ red: 1, blue: 0 });
  } finally {
    await isolated.dispose();
  }
}, 30000);
