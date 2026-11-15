export type Team = "red" | "blue";
export interface Fighter { id: string; team: Team; name: string; tagline: string }
export const fighters: Record<Team, readonly Fighter[]> = {
  red: [
    { id: "moderate-republican", team: "red", name: "Moderate Republican", tagline: "Pragmatism. Stability. Common ground." },
    { id: "conservative", team: "red", name: "Conservative", tagline: "Tradition. Personal responsibility. Limited government." },
    { id: "very-conservative", team: "red", name: "Very Conservative", tagline: "Conviction. Tradition. Constitutional principles." },
  ],
  blue: [
    { id: "moderate-democrat", team: "blue", name: "Moderate Democrat", tagline: "Pragmatism. Opportunity. Common ground." },
    { id: "liberal", team: "blue", name: "Liberal", tagline: "Civil liberties. Inclusion. Social opportunity." },
    { id: "progressive", team: "blue", name: "Progressive", tagline: "Social progress. Economic equality. Systemic change." },
  ],
};
