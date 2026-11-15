import { ensureOperations } from "./operations";
import type { Answer } from "../game/scoring";

export interface Candidate {
  id: string;
  prompt: string;
  criteria: string;
  decisionAt: string;
  subject?: string;
  office?: string;
  closesAt?: string;
}

export interface VerifiedDecision {
  outcome: Answer;
  sourceUrl: string;
}

export interface AutonomousSource {
  discover(now: Date): Promise<Candidate[]>;
  verify(candidate: Candidate): Promise<VerifiedDecision | null>;
}

const day = 86400000;

async function ensureRegistry(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS autonomous_questions (
      id TEXT PRIMARY KEY REFERENCES questions(id),
      published_day TEXT NOT NULL UNIQUE,
      decision_at TEXT NOT NULL,
      subject TEXT,
      office TEXT,
      checked_at TEXT
    )
  `).run();
}

export async function publishDaily(db: D1Database, source: AutonomousSource, time: number): Promise<string> {
  await ensureRegistry(db);
  await ensureOperations(db);
  const now = new Date(time);
  const opensAt = now.toISOString();
  const date = opensAt.slice(0, 10);
  const busy = await db.prepare(`
    SELECT 1 FROM autonomous_questions WHERE published_day = ?1
    UNION ALL SELECT 1 FROM questions WHERE status = 'open' AND opens_at <= ?2 AND closes_at > ?2
    LIMIT 1
  `).bind(date, opensAt).first();
  if (busy) return "slot-occupied";
  const action = await db.prepare("SELECT action FROM editorial_actions WHERE question_id IS NULL ORDER BY seq DESC LIMIT 1")
    .first<string>("action");
  if (action === "pause") return "paused";

  const candidates = await source.discover(now);
  for (const candidate of candidates) {
    const decision = Date.parse(candidate.decisionAt);
    if (!Number.isFinite(decision) || decision - time < 3600000) continue;
    const closesAt = new Date(Math.min(time + day, decision - 15 * 60000)).toISOString();
    const [insert] = await db.batch([
      db.prepare(`
        INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
        SELECT ?1, ?2, ?3, ?4, ?5
        WHERE COALESCE((SELECT action FROM editorial_actions WHERE question_id IS NULL ORDER BY seq DESC LIMIT 1), '') <> 'pause'
          AND NOT EXISTS (SELECT 1 FROM autonomous_questions WHERE published_day = ?6)
          AND NOT EXISTS (
            SELECT 1 FROM questions WHERE status = 'open' AND opens_at < ?5 AND closes_at > ?4
          )
        ON CONFLICT(id) DO NOTHING
      `).bind(candidate.id, candidate.prompt, candidate.criteria, opensAt, closesAt, date),
      db.prepare(`
        INSERT INTO autonomous_questions (id, published_day, decision_at, subject, office)
        SELECT id, ?1, ?2, ?3, ?4 FROM questions WHERE id = ?5 AND opens_at = ?6
        ON CONFLICT DO NOTHING
      `).bind(date, candidate.decisionAt, candidate.subject ?? null, candidate.office ?? null, candidate.id, opensAt),
    ]);
    if (insert.meta.changes) {
      console.info("Published autonomous question", { id: candidate.id, closesAt });
      return "published";
    }
  }
  return "no-eligible-candidate";
}

export async function resolveDue(
  db: D1Database,
  source: AutonomousSource,
  candidates: Candidate[],
  time: number,
): Promise<void> {
  const now = new Date(time).toISOString();
  const results = await Promise.allSettled(candidates.map(async (candidate) => {
    if (candidate.decisionAt > now) return;
    const pending = await db.prepare(`
      SELECT closes_at FROM questions WHERE id = ? AND closes_at <= ? AND status IN ('open', 'closed')
    `).bind(candidate.id, now).first<string>("closes_at");
    if (!pending) return;
    const decision = await source.verify({ ...candidate, closesAt: pending });
    await db.prepare("UPDATE autonomous_questions SET checked_at = ? WHERE id = ?")
      .bind(now, candidate.id).run();
    if (!decision) return;
    const update = await db.prepare(`
      UPDATE questions SET status = 'resolved', outcome = ?, source_url = ?, resolved_at = ?
      WHERE id = ? AND closes_at <= ? AND status IN ('open', 'closed')
    `).bind(decision.outcome, decision.sourceUrl, now, candidate.id, now).run();
    if (update.meta.changes) console.info("Resolved autonomous question", { id: candidate.id });
  }));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new Error(`${failures.length} autonomous evidence checks failed`);
}

export async function runAutonomousCycle(db: D1Database, source: AutonomousSource, time: number): Promise<string> {
  await ensureRegistry(db);
  await ensureOperations(db);
  const { results } = await db.prepare(`
    SELECT q.id, q.prompt, q.criteria, a.decision_at AS decisionAt, a.subject, a.office
    FROM autonomous_questions a JOIN questions q ON q.id = a.id
    WHERE q.status IN ('open', 'closed') AND q.closes_at <= ?1 AND a.decision_at <= ?1
      AND NOT EXISTS (SELECT 1 FROM editorial_actions WHERE question_id = q.id AND action = 'void')
    ORDER BY a.checked_at, a.decision_at, a.id
    LIMIT 10
  `).bind(new Date(time).toISOString()).all<Candidate>();
  const tasks = await Promise.allSettled([resolveDue(db, source, results, time), publishDaily(db, source, time)]);
  const [resolution, publication] = tasks;
  if (resolution.status === "rejected") throw resolution.reason;
  if (publication.status === "rejected") throw publication.reason;
  return publication.value;
}
