import { expect, test } from "vitest";
import { parseSchedule, senateSource } from "./senate";

const schedule = `
<h2>Floor Log</h2><ol><li>Confirmation of Executive Calendar #900, Other Person, to be Secretary.</li></ol>
<h2 class="elementor-heading-title">Floor Schedule</h2>
<p>The Senate will convene at 3:00pm on Monday, November 16, 2026.</p>
<p>At 5:30pm, on Monday, November 16th, the Senate will proceed to two roll call votes on the following:</p>
<ol><li>Confirmation of Executive Calendar #901, Daniel Desmond Domenico, of Colorado, to be United States Circuit Judge.</li>
<li>Motion to invoke cloture on a substitute amendment.</li></ol>
`;

test("discovers only a scheduled confirmation from the Senate floor notice", () => {
  const now = new Date("2026-11-16T13:00:00Z");
  expect(parseSchedule(schedule, now)).toMatchObject([{
    id: "senate-2026-901", subject: "Daniel Desmond Domenico", decisionAt: "2026-11-16T22:30:00.000Z",
  }]);
  expect(parseSchedule(schedule, new Date("2026-11-16T22:00:00Z"))).toEqual([]);
});

test("verifies a matching final roll call and ignores cloture and pre-close results", async () => {
  const candidate = { ...parseSchedule(schedule, new Date("2026-11-16T13:00:00Z"))[0],
    closesAt: "2026-11-16T22:15:00.000Z" };
  const title = "Confirmation: Daniel Desmond Domenico to be U.S. Circuit Judge";
  const menu = `<vote><vote_number>00262</vote_number><question>On the Nomination</question><title>${title}</title></vote>
    <vote><vote_number>00261</vote_number><question>On the Cloture Motion</question><title>${title}</title></vote>`;
  let date = "November 16, 2026, 05:35 PM";
  let outcome = "Nomination Confirmed";
  const source = senateSource(async (url) => new Response(String(url).includes("vote_menu") ? menu :
    `<question>On the Nomination</question><vote_title>${title}</vote_title><vote_date>${date}</vote_date><vote_result>${outcome}</vote_result>`));
  expect(await source.verify(candidate)).toEqual({ outcome: "yes",
    sourceUrl: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00262.htm" });
  outcome = "Nomination Rejected";
  expect(await source.verify(candidate)).toMatchObject({ outcome: "no" });
  date = "November 16, 2026, 05:00 PM";
  expect(await source.verify(candidate)).toBeNull();
});
