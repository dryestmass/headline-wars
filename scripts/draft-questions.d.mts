export interface QuestionDraft {
  id: string;
  status: "needs-review";
  prompt: string;
  criteria: string;
  opensAt: string;
  closesAt: string;
  outcomeDeadline: string;
  sourceUrl: string;
  evidenceSearchUrl: string;
}

export function draftQuestions(options?: {
  now?: number;
  fetchSource?: typeof fetch;
}): Promise<QuestionDraft[]>;
