import type { Answer } from "../game/scoring";

export interface Candidate {
  id: string;
  prompt: string;
  criteria: string;
  decisionAt: string;
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

export async function publishDaily(db: D1Database, source: AutonomousSource, time: number): Promise<void> {
  const now = new Date(time);
  const candidates = await source.discover(now);
  const opensAt = now.toISOString();
  const closesAt = new Date(time + day).toISOString();
  for (const candidate of candidates) {
    if (candidate.decisionAt < closesAt) continue;
    const insert = await db.prepare(`
      INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
      SELECT ?, ?, ?, ?4, ?5
      WHERE NOT EXISTS (
        SELECT 1 FROM questions
        WHERE status = 'open' AND opens_at < ?5 AND closes_at > ?4
      )
      ON CONFLICT(id) DO NOTHING
    `).bind(candidate.id, candidate.prompt, candidate.criteria, opensAt, closesAt).run();
    if (insert.meta.changes) return;
  }
}

export async function resolveDue(
  db: D1Database,
  source: AutonomousSource,
  candidates: Candidate[],
  time: number,
): Promise<void> {
  const now = new Date(time).toISOString();
  for (const candidate of candidates) {
    if (candidate.decisionAt > now) continue;
    const pending = await db.prepare(`
      SELECT id FROM questions WHERE id = ? AND closes_at <= ? AND status IN ('open', 'closed')
    `).bind(candidate.id, now).first();
    if (!pending) continue;
    const decision = await source.verify(candidate);
    if (!decision) continue;
    await db.prepare(`
      UPDATE questions SET status = 'resolved', outcome = ?, source_url = ?, resolved_at = ?
      WHERE id = ? AND closes_at <= ? AND status IN ('open', 'closed')
    `).bind(decision.outcome, decision.sourceUrl, now, candidate.id, now).run();
  }
}
