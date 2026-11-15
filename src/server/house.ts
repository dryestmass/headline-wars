import type { AutonomousSource, Candidate } from "./autonomous";

const docs = "https://docs.house.gov";
const clerk = "https://clerk.house.gov";
const day = 86400000;
const date = (time: number) => new Date(time).toISOString().slice(0, 10);
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" });
const easternDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function text(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&(?:nbsp|#160);/g, " ").replace(/\s+/g, " ").trim();
}

function xmlValue(xml: string, tag: string): string {
  return text(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(xml)?.[1] ?? "");
}

function easternTime(isoDate: string, hour: number, minute: number): number {
  const midnight = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(midnight) || hour > 23 || minute > 59) return NaN;
  const offset = zone.formatToParts(midnight + 12 * 3600000).find((part) => part.type === "timeZoneName")?.value;
  const hours = /^GMT-(0[45]):00$/.exec(offset ?? "")?.[1];
  return hours ? midnight + (Number(hours) + hour) * 3600000 + minute * 60000 : NaN;
}

function billNumber(value: string): string | undefined {
  return /^H\s*\.?\s*R\s*\.?\s*(\d{1,6})$/i.exec(value)?.[1];
}

function passage(question: string): boolean {
  return /^(?:On Passage|On Motion to Suspend the Rules and Pass)(?:, as Amended)?$/i.test(question);
}

interface Roll {
  number: number;
  bill: string;
  date: string;
}

function indexVotes(html: string, year: number): Roll[] {
  const rolls: Roll[] = [];
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), ([, value]) => text(value));
    if (cells.length < 5 || !/^\d{1,4}$/.test(cells[0]) || !passage(cells[3])) continue;
    const bill = billNumber(cells[2]);
    const parts = /^(\d{1,2})-([A-Za-z]{3})$/.exec(cells[1]);
    if (!bill || !parts) continue;
    const month = months.indexOf(parts[2]) + 1;
    if (!month) continue;
    rolls.push({ number: Number(cells[0]), bill,
      date: `${year}-${String(month).padStart(2, "0")}-${parts[1].padStart(2, "0")}` });
  }
  return rolls;
}

export function parseHouseSchedule(xml: string, week: string): Candidate[] {
  const root = /<floorschedule\b([^>]*)>/.exec(xml)?.[1];
  const congress = /\bcongress-num="(\d+)"/.exec(root ?? "")?.[1];
  if (!root || !congress || /\bweek-date="([^"]+)"/.exec(root)?.[1] !== week) return [];
  const friday = date(Date.parse(week + "T00:00:00Z") + 4 * day);
  const decisionAt = new Date(easternTime(friday, 23, 59)).toISOString();
  const scheduleUrl = `${docs}/floor/Default.aspx?date=${week}`;
  const candidates = new Map<string, Candidate>();
  const categories = Array.from(xml.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>/g));
  // Bills debated under a rule are a better first choice than routine suspension bills.
  categories.sort((a, b) => Number(/pursuant to a rule/i.test(b[1])) - Number(/pursuant to a rule/i.test(a[1])));
  for (const [, attributes, category] of categories) {
    if (!/pursuant to a rule|under suspension of the rules/i.test(attributes)) continue;
    for (const [, entry, item] of category.matchAll(/<floor-item\b([^>]*)>([\s\S]*?)<\/floor-item>/g)) {
      if (!/\bremove-date=""/.test(entry)) continue;
      const bill = billNumber(xmlValue(item, "legis-num"));
      const title = xmlValue(item, "floor-text");
      if (!bill || !title || title.length > 180 || candidates.has(bill)) continue;
      candidates.set(bill, {
        id: `house-${congress}-hr${bill}`,
        prompt: `Will the House pass H.R. ${bill} (${title.replace(/[., ]+$/, "").replace(/, as amended$/i, "")})?`,
        criteria: `Use the first House Clerk final-passage roll call on H.R. ${bill} after voting closes and through ${friday} Eastern. YES if it passes, NO if it fails. A missing or pre-close result stays pending. House floor schedule: ${scheduleUrl}`,
        subject: bill,
        office: congress,
        decisionAt,
      });
    }
  }
  return [...candidates.values()];
}

export function houseSource(fetchSource: typeof fetch = fetch): AutonomousSource {
  async function get(url: string, missingAllowed = false): Promise<string> {
    const response = await fetchSource(url, { signal: AbortSignal.timeout(12000) });
    if (missingAllowed && response.status === 404) return "";
    if (!response.ok) throw new Error(`House source returned HTTP ${response.status}`);
    return response.text();
  }

  const indexes = new Map<number, Promise<Roll[]>>();
  function rollsFor(year: number): Promise<Roll[]> {
    const existing = indexes.get(year);
    if (existing) return existing;
    const load = (async () => {
      const base = `${clerk}/evslegacy/${year}/`;
      const index = await get(base + "index.asp");
      const pages = [...new Set(Array.from(index.matchAll(/href="(ROLL_\d{3}\.asp)"/gi), ([, page]) => page))]
        .sort().reverse().slice(0, 2);
      if (!pages.length) throw new Error("House roll call index links missing");
      const lists = await Promise.all(pages.map((page) => get(base + page)));
      return lists.flatMap((list) => indexVotes(list, year));
    })();
    indexes.set(year, load);
    return load;
  }

  return {
    async discover(now) {
      const formatted = easternDay.format(now);
      const today = Date.parse(formatted + "T00:00:00Z");
      const weekday = new Date(today).getUTCDay();
      if (![0, 1, 2, 3].includes(weekday)) return [];
      const week = date(today + (weekday === 0 ? 1 : 1 - weekday) * day);
      const key = week.replaceAll("-", "");
      const candidates = parseHouseSchedule(await get(`${docs}/billsthisweek/${key}/${key}.xml`, true), week);
      if (!candidates.length) return [];
      const rolls = await rollsFor(Number(week.slice(0, 4)));
      return candidates.filter((candidate) => !rolls.some((roll) => roll.bill === candidate.subject));
    },
    async verify(candidate) {
      if (!candidate.subject || !candidate.office || !candidate.closesAt) return null;
      const latest = easternDay.format(new Date(candidate.decisionAt));
      const year = Number(latest.slice(0, 4));
      if (!Number.isInteger(year) || year < 2026 || year > 2100) return null;
      const earliest = easternDay.format(new Date(candidate.closesAt));
      const rolls = (await rollsFor(year)).filter((roll) =>
        roll.bill === candidate.subject && roll.date >= earliest && roll.date <= latest)
        .sort((a, b) => a.number - b.number);
      for (const roll of rolls.slice(0, 3)) {
        const number = String(roll.number).padStart(3, "0");
        const source = `${clerk}/evs/${year}/roll${number}`;
        const xml = await get(source + ".xml");
        if (xmlValue(xml, "congress") !== candidate.office || billNumber(xmlValue(xml, "legis-num")) !== candidate.subject ||
            !passage(xmlValue(xml, "vote-question"))) continue;
        const actionDate = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(xmlValue(xml, "action-date"));
        const clock = /<action-time\b[^>]*\btime-etz="(\d{2}):(\d{2})"/.exec(xml);
        const month = actionDate ? months.indexOf(actionDate[2]) + 1 : 0;
        if (!actionDate || !clock || !month) continue;
        const time = easternTime(`${actionDate[3]}-${String(month).padStart(2, "0")}-${actionDate[1].padStart(2, "0")}`,
          Number(clock[1]), Number(clock[2]));
        if (!(time >= Date.parse(candidate.closesAt) && time <= Date.parse(candidate.decisionAt))) continue;
        const result = xmlValue(xml, "vote-result");
        if (result === "Passed") return { outcome: "yes", sourceUrl: source + ".xml" };
        if (result === "Failed") return { outcome: "no", sourceUrl: source + ".xml" };
      }
      return null;
    },
  };
}
