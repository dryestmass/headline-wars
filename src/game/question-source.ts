export function questionSource(criteria: string): { criteria: string; url?: string } {
  const match = /\s+(?:House floor schedule|Floor schedule): (https:\/\/\S+)\s*$/.exec(criteria);
  if (!match) return { criteria };
  try {
    const url = new URL(match[1]);
    if (!["docs.house.gov", "www.periodicalpress.senate.gov"].includes(url.hostname) ||
        url.username || url.password || url.port) return { criteria };
    return { criteria: criteria.slice(0, match.index), url: url.href };
  } catch {
    return { criteria };
  }
}
