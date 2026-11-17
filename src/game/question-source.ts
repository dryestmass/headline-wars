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

/** Player-facing context is separate from the immutable scoring criteria. */
export function questionExplanation(question: { id: string; prompt: string; criteria: string }): { text: string; url?: string; linkLabel?: string } | undefined {
  const injury = /workplace injury and illness rate fall below ([\d.]+) cases per 100 workers/i.exec(question.prompt);
  if (injury && question.id.startsWith("bls-workplace-injury-rate-")) {
    const year = /-(\d{4})$/.exec(question.id)?.[1];
    if (!year) return undefined;
    return {
      text: `This report counts how often people got hurt or sick because of their jobs in ${year}, at private companies across the U.S. You're voting on whether the rate will be below ${injury[1]} cases for every 100 full-time workers.`,
      url: "https://www.bls.gov/iif/nonfatal-injuries-and-illnesses-tables.htm",
      linkLabel: "Read about the workplace injury report",
    };
  }
  return undefined;
}
