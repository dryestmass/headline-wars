import { expect, test } from "vitest";
import { questionSource } from "./question-source";

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
