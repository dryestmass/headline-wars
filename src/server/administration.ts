import { easternDateTime } from "./rollover";
import type { AutonomousSource, Candidate } from "./autonomous";

interface Watch extends Candidate {
  context: string;
  contextUrl: string;
  documentTitle: string;
  documentType: "Rule" | "Presidential Document";
}

// Add entries only when a sourced public commitment has a specific, verifiable milestone.
const watchlist: readonly Watch[] = [];

export function administrationSource(fetchSource: typeof fetch = fetch, watches = watchlist): AutonomousSource {
  return {
    async discover(now) {
      return watches.filter((watch) => {
        const days = (Date.parse(watch.decisionAt) - now.getTime()) / 86_400_000;
        return days > 0 && days <= 7;
      }).map(({ id, prompt, criteria, decisionAt, context, contextUrl }) => ({
        id, prompt, decisionAt,
        criteria: `${criteria}\nBackground: ${context}\nPromise source: ${contextUrl}`,
      }));
    },
    async verify(candidate) {
      const watch = watches.find(({ id }) => id === candidate.id);
      if (!watch || !candidate.closesAt) return null;

      const first = easternDateTime(Date.parse(candidate.closesAt)).date;
      const last = easternDateTime(Date.parse(candidate.decisionAt)).date;
      const endpoint = new URL("https://www.federalregister.gov/api/v1/documents.json");
      endpoint.searchParams.set("conditions[term]", watch.documentTitle);
      endpoint.searchParams.set("conditions[publication_date][gte]", first);
      endpoint.searchParams.set("conditions[publication_date][lte]", last);
      const response = await fetchSource(endpoint);
      if (!response.ok) throw new Error(`Federal Register search failed (${response.status})`);
      const data = await response.json() as { results: Array<{
        title: string; type: string; publication_date: string; document_number: string;
      }> };
      const record = data.results.find((item) => item.title === watch.documentTitle
        && item.type === watch.documentType && item.publication_date > first && item.publication_date <= last
        && /^\d{4}-\d+$/.test(item.document_number));
      // Publication dates have day precision. Same-day and absent evidence require review.
      return record ? { outcome: "yes", sourceUrl: `https://www.federalregister.gov/d/${record.document_number}` } : null;
    },
  };
}
