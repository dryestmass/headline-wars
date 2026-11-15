import type { AutonomousSource, Candidate, VerifiedDecision } from "./autonomous";

const floorUrl = "https://www.periodicalpress.senate.gov/";
const senate = "https://www.senate.gov/legislative/LIS";
const day = 86400000;
const months = "January February March April May June July August September October November December".split(" ");
const eastern = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" });

function easternTime(month: string, date: string, year: string, hour: string, minute: string, period: string): number {
  const index = months.indexOf(month);
  const clockHour = Number(hour);
  if (index < 0 || clockHour < 1 || clockHour > 12 || Number(minute) > 59) return NaN;
  const utc = Date.UTC(Number(year), index, Number(date), clockHour % 12 + (period.toLowerCase() === "pm" ? 12 : 0), Number(minute));
  if (new Date(utc).getUTCMonth() !== index) return NaN;
  const zone = eastern.formatToParts(utc + 5 * 3600000).find((part) => part.type === "timeZoneName")?.value;
  const offset = /^GMT-(0[45]):00$/.exec(zone ?? "");
  return offset ? utc + Number(offset[1]) * 3600000 : NaN;
}

function text(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();
}

function xmlValue(xml: string, tag: string): string {
  return text(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? "");
}

export function parseSchedule(html: string, now: Date): Candidate[] {
  const schedule = /<h2[^>]*>\s*Floor Schedule\s*<\/h2>([\s\S]*?)(?=<h2|<footer|$)/i.exec(html)?.[1];
  if (!schedule) throw new Error("Senate floor schedule section missing");
  const overview = text(schedule);
  const session = /will convene at .+? on \w+, (\w+) (\d{1,2}), (\d{4})\./i.exec(overview);
  const vote = /At (\d{1,2}):(\d{2})\s*([ap]m),? on \w+, (\w+) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?,? the Senate will proceed to .*?roll call vote/i.exec(overview);
  if (!session || !vote || vote[4] !== session[1] || vote[5] !== session[2]) return [];
  const year = vote[6] ?? session[3];
  if (year !== session[3]) return [];
  const decisionTime = easternTime(vote[4], vote[5], year, vote[1], vote[2], vote[3]);
  if (!Number.isFinite(decisionTime) || decisionTime <= now.getTime() + 3600000 || decisionTime > now.getTime() + 4 * day) return [];

  const candidates: Candidate[] = [];
  const list = /<ol\b[^>]*>([\s\S]*?)<\/ol>/i.exec(schedule)?.[1] ?? "";
  for (const item of list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const description = text(item[1]);
    const office = /\bto be (.+)$/.exec(description)?.[1];
    const nomination = /^Confirmation of Executive Calendar #(\d+),? ([\p{L}.' -]+?)(?:,| to be )/u.exec(description);
    if (!nomination || !office) continue;
    const [, calendar, name] = nomination;
    candidates.push({
      id: `senate-${year}-${calendar}`,
      prompt: `Will the Senate confirm ${name}?`,
      criteria: `YES if the Senate's official confirmation roll call for ${name}, Executive Calendar #${calendar}, records a confirmation. NO if it records a rejection. A delayed or missing roll call remains pending. Floor schedule: ${floorUrl}`,
      decisionAt: new Date(decisionTime).toISOString(),
      subject: name,
      office,
    });
  }
  const priority = (candidate: Candidate) => /^(?:U\.?S\.? )?(?:Secretary|Attorney General|Administrator|Director)\b/i.test(candidate.office ?? "") ? 1 : 0;
  return candidates.sort((a, b) => priority(b) - priority(a));
}

function normalizeOffice(office: string): string {
  return office.toLowerCase().replace(/u\.s\.\s*/g, "united states ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function nominationMatch(title: string, name: string, office: string): boolean {
  const normalized = title.toLowerCase();
  const prefix = `confirmation: ${name.toLowerCase()}`;
  const role = /\bto be (.+)$/.exec(normalized)?.[1];
  return Boolean(role && normalizeOffice(role) === normalizeOffice(office) &&
    (normalized.startsWith(`${prefix},`) || normalized.startsWith(`${prefix} to be `)));
}

export function senateSource(fetchSource: typeof fetch = fetch): AutonomousSource {
  async function get(url: string): Promise<string> {
    const response = await fetchSource(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Senate source returned HTTP ${response.status}`);
    return response.text();
  }
  const menus = new Map<string, Promise<string>>();
  return {
    async discover(now) {
      return parseSchedule(await get(floorUrl), now);
    },
    async verify(candidate): Promise<VerifiedDecision | null> {
      if (!candidate.subject || !candidate.office || !candidate.closesAt) return null;
      const year = Number(candidate.id.split("-")[1]);
      if (!Number.isInteger(year) || year < 2026 || year > 2100) return null;
      const congress = Math.floor((year - 1789) / 2) + 1;
      const session = year % 2 ? 1 : 2;
      const menuUrl = `${senate}/roll_call_lists/vote_menu_${congress}_${session}.xml`;
      const pendingMenu = menus.get(menuUrl) ?? get(menuUrl);
      menus.set(menuUrl, pendingMenu);
      const menu = await pendingMenu;
      const matches = Array.from(menu.matchAll(/<vote>([\s\S]*?)<\/vote>/g), ([, row]) => row)
        .filter((row) => xmlValue(row, "question") === "On the Nomination" &&
          nominationMatch(xmlValue(row, "title"), candidate.subject!, candidate.office!));
      for (const row of matches.slice(0, 3)) {
        const number = xmlValue(row, "vote_number");
        if (!/^\d{5}$/.test(number)) continue;
        const path = `${senate}/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${number}`;
        const roll = await get(path + ".xml");
        if (xmlValue(roll, "question") !== "On the Nomination" ||
            !nominationMatch(xmlValue(roll, "vote_title"), candidate.subject, candidate.office)) continue;
        const date = /^(\w+) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}) ([AP]M)$/.exec(xmlValue(roll, "vote_date"));
        if (!date || !(easternTime(date[1], date[2], date[3], date[4], date[5], date[6]) >= Date.parse(candidate.closesAt))) continue;
        const result = xmlValue(roll, "vote_result");
        if (result === "Nomination Confirmed") return { outcome: "yes", sourceUrl: path + ".htm" };
        if (result === "Nomination Rejected") return { outcome: "no", sourceUrl: path + ".htm" };
      }
      return null;
    },
  };
}
