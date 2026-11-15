const schemas = new WeakMap<D1Database, Promise<void>>();
const hour = 3600000;

export function ensureOperations(db: D1Database): Promise<void> {
  const existing = schemas.get(db);
  if (existing) return existing;
  const setup = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS job_health (
      job TEXT PRIMARY KEY, attempted_at TEXT NOT NULL, succeeded_at TEXT, state TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS editorial_actions (
      seq INTEGER PRIMARY KEY, action TEXT NOT NULL CHECK(action IN ('pause','resume','void','correct')),
      question_id TEXT REFERENCES questions(id), outcome TEXT CHECK(outcome IN ('yes','no')),
      source_url TEXT, reason TEXT NOT NULL CHECK(trim(reason) <> ''),
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      CHECK (
        (action IN ('pause','resume') AND question_id IS NULL AND outcome IS NULL AND source_url IS NULL) OR
        (action = 'void' AND question_id IS NOT NULL AND outcome IS NULL AND source_url IS NULL) OR
        (action = 'correct' AND question_id IS NOT NULL AND outcome IS NOT NULL AND
          source_url IS NOT NULL AND source_url GLOB 'https://?*')
      )
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS editorial_actions_by_question ON editorial_actions(question_id, seq DESC)"),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS editorial_correct_verified BEFORE INSERT ON editorial_actions
      WHEN NEW.action = 'correct' AND NOT EXISTS (
        SELECT 1 FROM questions WHERE id = NEW.question_id AND status = 'resolved'
          AND NOT EXISTS (SELECT 1 FROM editorial_actions WHERE action = 'void' AND question_id = NEW.question_id)
      )
      BEGIN SELECT RAISE(ABORT, 'Only verified results can be corrected'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS editorial_void_open AFTER INSERT ON editorial_actions
      WHEN NEW.action = 'void'
      BEGIN UPDATE questions SET status = 'void', outcome = NULL, source_url = NULL, resolved_at = NULL
        WHERE id = NEW.question_id AND status IN ('open','closed'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS editorial_actions_no_update BEFORE UPDATE ON editorial_actions
      BEGIN SELECT RAISE(ABORT, 'Editorial actions are append-only'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS editorial_actions_no_delete BEFORE DELETE ON editorial_actions
      BEGIN SELECT RAISE(ABORT, 'Editorial actions are append-only'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vote_rate (
      network TEXT NOT NULL, minute INTEGER NOT NULL, attempts INTEGER NOT NULL,
      PRIMARY KEY (network, minute)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS vote_rate_by_minute ON vote_rate(minute)"),
  ]).then(() => undefined).catch((error: unknown) => {
    schemas.delete(db);
    throw error;
  });
  schemas.set(db, setup);
  return setup;
}

export async function allowVote(db: D1Database, hash: string, time: number): Promise<boolean> {
  await ensureOperations(db);
  const result = await db.prepare(`
    INSERT INTO vote_rate (network, minute, attempts) VALUES (?, ?, 1)
    ON CONFLICT(network, minute) DO UPDATE SET attempts = attempts + 1
    WHERE attempts < 30
    RETURNING attempts
  `).bind(hash, Math.floor(time / 60000)).first();
  return result !== null;
}

export async function trackJob<T>(
  db: D1Database,
  job: string,
  time: number,
  run: () => Promise<T>,
  state: (result: T) => string = () => "ok",
): Promise<T> {
  await ensureOperations(db);
  const stamp = new Date(time).toISOString();
  async function record(value: string, succeeded: boolean) {
    await db.prepare(`
      INSERT INTO job_health (job, attempted_at, succeeded_at, state) VALUES (?, ?, ?, ?)
      ON CONFLICT(job) DO UPDATE SET attempted_at = excluded.attempted_at,
        succeeded_at = COALESCE(excluded.succeeded_at, job_health.succeeded_at), state = excluded.state
      WHERE excluded.attempted_at >= job_health.attempted_at
    `).bind(job, stamp, succeeded ? stamp : null, value).run();
  }

  try {
    const result = await run();
    await record(state(result), true);
    return result;
  } catch (error) {
    await record("failed", false);
    throw error;
  }
}

const expected = { congressional: 3 * hour, evidence: 3 * hour, federal: 30 * hour } as const;

export async function readHealth(db: D1Database, time: number) {
  await ensureOperations(db);
  const { results } = await db.prepare("SELECT job, attempted_at, succeeded_at, state FROM job_health")
    .all<{ job: string; attempted_at: string; succeeded_at: string | null; state: string }>();
  const jobs = Object.entries(expected).map(([job, maxAge]) => {
    const entry = results.find((row) => row.job === job);
    return { job, ...entry, stale: !entry?.succeeded_at || time - Date.parse(entry.succeeded_at) > maxAge };
  });
  const registry = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'autonomous_questions'").first();
  const overdue = registry ? await db.prepare(`
    SELECT COUNT(*) AS count FROM autonomous_questions a JOIN questions q ON q.id = a.id
    WHERE a.decision_at < ? AND q.status IN ('open','closed')
      AND NOT EXISTS (SELECT 1 FROM editorial_actions WHERE question_id = q.id AND action = 'void')
  `).bind(new Date(time - 48 * hour).toISOString()).first<number>("count") : 0;
  const pause = await db.prepare("SELECT action FROM editorial_actions WHERE question_id IS NULL ORDER BY seq DESC LIMIT 1")
    .first<string>("action");
  const sources = results.filter((row) => row.job.startsWith("source-"));
  return {
    ok: jobs.every((job) => !job.stale && job.state !== "failed") &&
      sources.every((source) => source.state !== "failed") && !overdue,
    paused: pause === "pause",
    overdue,
    jobs,
    sources,
  };
}
