import type { Answer, QuestionVotes, Team, Winner } from "./scoring";

export interface Ballot {
  team: Team;
  answer: Answer;
}

export interface Question {
  id: string;
  prompt: string;
  criteria: string;
  opensAt: string;
  closesAt: string;
  status: "open" | "closed" | "resolved" | "void";
  outcome: Answer | null;
  sourceUrl: string | null;
  votes: QuestionVotes;
  winner: Winner | null;
  ballot: Ballot | null;
}

export interface Game {
  questions: Question[];
  scores: Record<Team, number>;
  votingEnabled: boolean;
}
