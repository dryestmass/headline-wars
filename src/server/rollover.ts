export const DAILY_ROLLOVER = "0 19,20 * * *";
export const ROLLOVER_HOUR = 15;

const eastern = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function easternDateTime(time: number) {
  const { year, month, day, hour } = Object.fromEntries(
    eastern.formatToParts(time).map(({ type, value }) => [type, value]),
  );
  return { date: `${year}-${month}-${day}`, hour: Number(hour) };
}

export function nextRollover(time: number): number {
  const { date } = easternDateTime(time);
  const nextDaySummer = Date.parse(`${date}T19:00:00Z`) + 86_400_000;
  return easternDateTime(nextDaySummer).hour === ROLLOVER_HOUR
    ? nextDaySummer
    : nextDaySummer + 3_600_000;
}
