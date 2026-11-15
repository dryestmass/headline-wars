import { pathToFileURL } from "node:url";

const documents = "https://www.federalregister.gov/api/v1/documents.json";
const day = 86400000;
const date = (time) => new Date(time).toISOString().slice(0, 10);
const docketId = /^(?:Docket (?:No\. |ID )?)?([A-Z0-9]+(?:-[A-Z0-9]+){2,})$/i;

export async function draftQuestions({ now = Date.now(), fetchSource = fetch } = {}) {
  const today = date(now);
  const url = new URL(documents);
  for (const field of ["document_number", "title", "publication_date", "html_url", "docket_ids"]) {
    url.searchParams.append("fields[]", field);
  }
  url.searchParams.set("per_page", "20");
  url.searchParams.set("order", "newest");
  url.searchParams.append("conditions[type][]", "PRORULE");
  url.searchParams.set("conditions[publication_date][gte]", date(now - 7 * day));
  url.searchParams.set("conditions[publication_date][lte]", today);
  const response = await fetchSource(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Federal Register returned HTTP ${response.status}`);
  const { results, count } = await response.json();
  if (count === 0 && results === undefined) return [];
  if (!Array.isArray(results)) throw new Error("Unexpected Federal Register response");

  const opensAt = date(now + day) + "T00:00:00.000Z";
  const closesAt = date(now + 2 * day) + "T00:00:00.000Z";
  const firstDate = date(now + 2 * day);
  const lastDate = date(now + 91 * day);
  const seen = new Set();
  const drafts = [];
  for (const document of results) {
    if (!document || !Array.isArray(document.docket_ids)) continue;
    const dockets = new Set(document.docket_ids.flatMap((id) => {
      const docket = typeof id === "string" ? docketId.exec(id.trim())?.[1] : undefined;
      return docket ? [docket.toUpperCase()] : [];
    }));
    const [docket] = dockets;
    if (dockets.size !== 1 || seen.has(docket)) continue;
    const { title, publication_date: published, document_number: number, html_url: source } = document;
    if (typeof title !== "string" || !title.trim() || typeof number !== "string" ||
        !/^\d{4}-\d{5}$/.test(number) || typeof published !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(published) || published > today || published < date(now - 7 * day) ||
        typeof source !== "string" || !source.startsWith("https://www.federalregister.gov/documents/")) continue;

    const evidence = new URL(documents);
    evidence.searchParams.set("conditions[docket_id]", docket);
    evidence.searchParams.append("conditions[type][]", "RULE");
    evidence.searchParams.set("conditions[publication_date][gte]", firstDate);
    evidence.searchParams.set("conditions[publication_date][lte]", lastDate);
    drafts.push({
      id: `fr-${number}`,
      status: "needs-review",
      prompt: `Will a federal rule for “${title.trim()}” be published by ${lastDate}?`,
      criteria: `YES if the Federal Register publishes a document classified as Rule for docket ${docket} that finalizes proposed document ${number} and a publication date from ${firstDate} through ${lastDate}, inclusive. NO if no matching document is found after the deadline and the Federal Register record is complete. Leave pending if the evidence is inconclusive.`,
      opensAt,
      closesAt,
      outcomeDeadline: lastDate,
      sourceUrl: source,
      evidenceSearchUrl: evidence.href,
    });
    seen.add(docket);
  }
  return drafts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(JSON.stringify(await draftQuestions(), null, 2) + "\n");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
