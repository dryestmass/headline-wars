export type Answer = "yes" | "no";
export type Team = "red" | "blue";
export type Winner = Team | "tie" | "unscored";

export interface VoteCounts {
  yes: number;
  no: number;
}

export interface QuestionVotes {
  red: VoteCounts;
  blue: VoteCounts;
}

export interface TeamAccuracy {
  correct: number;
  total: number;
  rate: number | null;
}

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Vote counts must be non-negative safe integers");
  }
}

export function accuracy(votes: VoteCounts, outcome: Answer): TeamAccuracy {
  assertCount(votes.yes);
  assertCount(votes.no);
  const total = votes.yes + votes.no;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Vote total exceeds the safe integer range");
  }
  const correct = votes[outcome];
  return { correct, total, rate: total === 0 ? null : correct / total };
}

/**
 * A headline is won by the team with the greater share of correct votes.
 * Teams with no votes cannot win. Equal accuracy awards no point.
 * Cross-multiplication avoids floating-point tie comparisons.
 */
export function winner(votes: QuestionVotes, outcome: Answer): Winner {
  const red = accuracy(votes.red, outcome);
  const blue = accuracy(votes.blue, outcome);

  if (red.total === 0 && blue.total === 0) return "unscored";
  if (red.total === 0) return "blue";
  if (blue.total === 0) return "red";

  const redShare = BigInt(red.correct) * BigInt(blue.total);
  const blueShare = BigInt(blue.correct) * BigInt(red.total);
  if (redShare === blueShare) return "tie";
  return redShare > blueShare ? "red" : "blue";
}
