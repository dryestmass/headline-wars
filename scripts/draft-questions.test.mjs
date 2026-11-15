import { expect, test } from "vitest";
import { draftQuestions } from "./draft-questions.mjs";

const now = Date.parse("2026-11-15T12:00:00Z");
const item = {
  title: "Synthetic proposal",
  document_number: "2026-12345",
  publication_date: "2026-11-13",
  html_url: "https://www.federalregister.gov/documents/synthetic-proposal",
  docket_ids: ["Docket No. FAA-2026-13802", "Project Identifier AD-2026-00597-T"],
};

test("builds review drafts with stable IDs and evidence searches", async () => {
  const drafts = await draftQuestions({ now, fetchSource: async (url) => {
    expect(url.searchParams.get("conditions[type][]")).toBe("PRORULE");
    expect(url.searchParams.get("conditions[publication_date][lte]")).toBe("2026-11-15");
    return Response.json({ results: [item, { ...item, document_number: "2026-12346" }] });
  } });
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({
    id: "fr-2026-12345",
    status: "needs-review",
    opensAt: "2026-11-16T00:00:00.000Z",
    closesAt: "2026-11-17T00:00:00.000Z",
    sourceUrl: item.html_url,
  });
  const evidence = new URL(drafts[0].evidenceSearchUrl);
  expect(evidence.searchParams.get("conditions[docket_id]")).toBe("FAA-2026-13802");
  expect(evidence.searchParams.get("conditions[type][]")).toBe("RULE");
  expect(evidence.searchParams.get("conditions[publication_date][gte]")).toBe("2026-11-17");
});

test("skips ambiguous or unusable source records", async () => {
  const results = [null, { ...item, docket_ids: ["FAA-2026-13802", "FAA-2026-13803"] },
    { ...item, publication_date: "2026-11-16" }, { ...item, html_url: "https://example.test" }];
  await expect(draftQuestions({ now, fetchSource: async () => Response.json({ results }) })).resolves.toEqual([]);
});

test("reports source failures and handles an empty feed", async () => {
  await expect(draftQuestions({ now, fetchSource: async () => Response.json({ count: 0 }) })).resolves.toEqual([]);
  await expect(draftQuestions({ now, fetchSource: async () => new Response(null, { status: 503 }) })).rejects.toThrow("HTTP 503");
});
