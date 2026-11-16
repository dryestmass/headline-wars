import { expect, test } from "vitest";
import { administrationSource } from "./administration";

test("links the original claim and requires a matching final publication", async () => {
  const watch = {
    id: "administration-fixture",
    prompt: "Will the agency publish the final fixture rule by Friday?",
    criteria: "YES if the final fixture rule is published by Friday.",
    context: "A synthetic agency announced the proposal.",
    contextUrl: "https://example.test/statement",
    decisionAt: "2026-11-21T04:59:59.000Z",
    documentTitle: "Fixture Rule",
    documentType: "Rule" as const,
  };
  let type = "Proposed Rule";
  let date = "2026-11-20";
  const source = administrationSource(async () => Response.json({ results: [{
    title: "Fixture Rule", type, publication_date: date, document_number: "2026-12345",
  }] }), [watch]);
  const [candidate] = await source.discover(new Date("2026-11-16T20:00:00Z"));
  expect(candidate.criteria).toContain("Promise source: https://example.test/statement");
  const closed = { ...candidate, closesAt: "2026-11-17T20:00:00Z" };
  expect(await source.verify(closed)).toBeNull();
  type = "Rule";
  date = "2026-11-17";
  expect(await source.verify(closed)).toBeNull();
  date = "2026-11-21";
  expect(await source.verify(closed)).toBeNull();
  date = "2026-11-20";
  expect(await source.verify(closed)).toEqual({
    outcome: "yes", sourceUrl: "https://www.federalregister.gov/d/2026-12345",
  });
});
