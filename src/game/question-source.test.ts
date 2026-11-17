import { expect, test } from "vitest";
import { questionExplanation, questionSource } from "./question-source";

test("extracts the official schedule reference from existing question criteria", () => {
  expect(questionSource("YES if passed. House floor schedule: https://docs.house.gov/floor/Default.aspx?date=2026-11-16"))
    .toEqual({ criteria: "YES if passed.", url: "https://docs.house.gov/floor/Default.aspx?date=2026-11-16" });
  expect(questionSource("YES if confirmed. Floor schedule: https://www.periodicalpress.senate.gov/"))
    .toEqual({ criteria: "YES if confirmed.", url: "https://www.periodicalpress.senate.gov/" });
});

test("leaves older criteria intact and does not link lookalike or invalid hosts", () => {
  for (const criteria of ["YES if published.", "Rule. Floor schedule: https://docs.house.gov.example/",
    "Rule. Floor schedule: https://user@docs.house.gov/", "Rule. Floor schedule: javascript:alert(1)"]) {
    expect(questionSource(criteria)).toEqual({ criteria });
  }
});

test("explains workplace injury ballots without exposing scoring instructions", () => {
  const explanation = questionExplanation({
    id: "bls-workplace-injury-rate-2025",
    prompt: "Will the U.S. private-sector workplace injury and illness rate fall below 2.3 cases per 100 workers?",
    criteria: "Use the initial BLS release. YES if below 2.3. If unavailable, leave pending.",
  });
  expect(explanation?.text).toContain("because of their jobs in 2025");
  expect(explanation?.text).toContain("below 2.3 cases for every 100 full-time workers");
  expect(explanation?.text).not.toMatch(/leave pending|YES if|getting safer/);
  expect(explanation?.url).toMatch(/^https:\/\/www.bls.gov\//);
  expect(questionExplanation({ id: "unknown", prompt: "A different question?", criteria: "Technical rules" })).toBeUndefined();
});
