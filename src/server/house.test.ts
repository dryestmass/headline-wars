import { expect, test } from "vitest";
import { congressSource } from "./congress";
import { houseSource, parseHouseSchedule } from "./house";

const schedule = `<floorschedule congress-num="119" week-date="2026-11-16">
<category type="Items that may be considered under suspension of the rules">
  <floor-item remove-date=""><legis-num>H.R. 7254</legis-num><floor-text>Trail Act</floor-text></floor-item>
</category>
<category type="Items that may be considered pursuant to a rule">
  <floor-item remove-date=""><legis-num>H.R. 3495</legis-num><floor-text>Direct Seller Act</floor-text></floor-item>
  <floor-item remove-date="2026-11-14"><legis-num>H.R. 1234</legis-num><floor-text>Removed</floor-text></floor-item>
</category></floorschedule>`;
const index = '<a href="ROLL_300.asp">Roll Calls 300 Thru 323</a>';
const row = (question: string, voteDate = "17-Nov") =>
  `<tr><td>323</td><td>${voteDate}</td><td>H R 3495</td><td>${question}</td><td>P</td></tr>`;

test("prioritizes rule bills and ignores removed bills and stale schedules", () => {
  const candidates = parseHouseSchedule(schedule, "2026-11-16");
  expect(candidates.map((candidate) => candidate.id)).toEqual(["house-119-hr3495", "house-119-hr7254"]);
  expect(candidates[0].decisionAt).toBe("2026-11-21T04:59:00.000Z");
  expect(parseHouseSchedule(schedule, "2026-11-09")).toEqual([]);
});

test("the combined source falls back to House and excludes bills already decided", async () => {
  const source = congressSource(async (input) => {
    const url = String(input);
    if (url.includes("senate.gov")) return new Response(null, { status: 503 });
    if (url.includes("billsthisweek")) return new Response(schedule);
    if (url.includes("index.asp")) return new Response(index);
    return new Response(row("On Passage", "13-Nov"));
  });
  expect((await source.discover(new Date("2026-11-17T14:00:00Z"))).map((candidate) => candidate.id))
    .toEqual(["house-119-hr7254"]);
});

test("verifies House passage or failure from the matching official roll call only", async () => {
  const candidate = { ...parseHouseSchedule(schedule, "2026-11-16")[0], closesAt: "2026-11-17T20:00:00.000Z" };
  const voteQuestion = "On Motion to Suspend the Rules and Pass, as Amended";
  let decision = "Passed";
  let clock = "16:30";
  let question = voteQuestion;
  const source = houseSource(async (input) => {
    const url = String(input);
    if (url.includes("index.asp")) return new Response(index);
    if (url.includes("ROLL_")) return new Response(row(voteQuestion));
    return new Response(`<congress>119</congress><legis-num>H R 3495</legis-num>
      <vote-question>${question}</vote-question><vote-result>${decision}</vote-result>
      <action-date>17-Nov-2026</action-date><action-time time-etz="${clock}">4:30 PM</action-time>`);
  });
  expect(await source.verify(candidate)).toEqual({ outcome: "yes", sourceUrl: "https://clerk.house.gov/evs/2026/roll323.xml" });
  decision = "Failed";
  expect(await source.verify(candidate)).toMatchObject({ outcome: "no" });
  clock = "14:30";
  expect(await source.verify(candidate)).toBeNull();
  clock = "16:30";
  question = "On Ordering the Previous Question";
  expect(await source.verify(candidate)).toBeNull();
});
