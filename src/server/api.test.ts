import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getPlatformProxy, type PlatformProxy } from "wrangler";
import type { Game } from "../game/model";
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

beforeAll(async () => {
  platform = await getPlatformProxy<Env>({ persist: false });
  env = { ...platform.env, VOTER_HASH_SECRET: crypto.randomUUID() };
  const schema = await readFile("migrations/0001_initial.sql", "utf8");
  await env.DB.exec(schema.replace(/^--.*$/gm, "").split(";").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean).join(";\n"));
  const lifecycle = await readFile("migrations/0002_editorial_lifecycle.sql", "utf8");
  for (const trigger of lifecycle.split(/\nEND;/).slice(0, -1)) {
    await env.DB.prepare(`${trigger.trim()}\nEND;`).run();
  }
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
