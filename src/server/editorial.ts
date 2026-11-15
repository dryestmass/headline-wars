import { draftQuestions } from "../../scripts/draft-questions.mjs";

export const NEWS_REFRESH = "0 13 * * *";
export const EVIDENCE_REFRESH = "30 * * * *";

async function ensureQueue(db: D1Database): Promise<void> {
  // Initialize the dev queue through the existing D1 binding on the first scheduled run.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS question_drafts (
      id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      discovered_at TEXT NOT NULL,
      evidence_checked_at TEXT,
      evidence_json TEXT
    )
  `).run();
}

export async function runEditorialJob(
  db: D1Database,
  cron: string,
  now: number,
  fetchSource: typeof fetch = fetch,
): Promise<void> {
  if (cron !== NEWS_REFRESH && cron !== EVIDENCE_REFRESH) throw new Error("Unknown editorial schedule");
  await ensureQueue(db);
  const timestamp = new Date(now).toISOString();
  if (cron === NEWS_REFRESH) {
    const drafts = await draftQuestions({ now, fetchSource });
    if (drafts.length) {
      await db.batch(drafts.map((draft) => db.prepare(`
        INSERT INTO question_drafts (id, draft_json, discovered_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).bind(draft.id, JSON.stringify(draft), timestamp)));
    }
    console.info("Editorial draft refresh completed", { candidates: drafts.length });
    return;
  }

  const { results } = await db.prepare(`
    SELECT d.id, json_extract(d.draft_json, '$.evidenceSearchUrl') AS search_url
    FROM question_drafts d JOIN questions q ON q.id = d.id
    WHERE q.status IN ('open', 'closed') AND q.closes_at <= ?1
      AND json_extract(d.draft_json, '$.outcomeDeadline') < substr(?1, 1, 10)
      AND (d.evidence_checked_at IS NULL OR d.evidence_checked_at <= ?2)
    ORDER BY d.evidence_checked_at, d.id
    LIMIT 5
  `).bind(timestamp, new Date(now - 86400000).toISOString()).all<{ id: string; search_url: string }>();

  const checks = await Promise.allSettled(results.map(async ({ id, search_url }) => {
    const url = new URL(search_url);
    if (url.origin !== "https://www.federalregister.gov" || url.pathname !== "/api/v1/documents.json") {
      throw new Error("Unexpected evidence source");
    }
    url.searchParams.set("per_page", "10");
    const response = await fetchSource(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Evidence source returned HTTP ${response.status}`);
    const { count, results: matches } = await response.json<{ count?: number; results?: unknown[] }>();
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || (count !== 0 && !Array.isArray(matches))) {
      throw new Error("Unexpected evidence response");
    }
    const evidence = { count, candidates: matches ?? [], searchUrl: url.href };
    await db.prepare("UPDATE question_drafts SET evidence_checked_at = ?, evidence_json = ? WHERE id = ?")
      .bind(timestamp, JSON.stringify(evidence), id).run();
  }));
  const failures = checks.filter((check) => check.status === "rejected");
  console.info("Editorial evidence refresh completed", { checked: results.length, failures: failures.length });
  if (failures.length) throw new Error(`${failures.length} editorial evidence checks failed`);
}
