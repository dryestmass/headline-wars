import type { Team } from "./scoring";

export function sprite(team: Team): string {
  return `<div class="fighter-sprite fighter-sprite--${team}" aria-hidden="true">
    <span class="fighter-pose fighter-pose--guard"></span>
    <span class="fighter-pose fighter-pose--jab"></span>
  </div>`;
}

