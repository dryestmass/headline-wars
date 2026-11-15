import { fighters, type Fighter, type Team } from "./fighters";
import { characterArt } from "./character-art";
import { startGame } from "./game/play";
import "./styles.css";

const key = "headline-wars:fighter";
const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
const app = root;
const index: Record<Team, number> = { red: 1, blue: 1 };

function remembered(): Fighter | undefined {
  try {
    const id = localStorage.getItem(key);
    return Object.values(fighters).flat().find((fighter) => fighter.id === id);
  } catch {
    return undefined;
  }
}

function panel(team: Team): string {
  const fighter = fighters[team][index[team]];
  return `<section class="fighter fighter--${team}">
    <p>TEAM ${team.toUpperCase()}</p>
    <div class="fighter__art">${characterArt(team, index[team])}<span class="fighter__number">FIGHTER ${index[team] + 1}</span></div>
    <div class="fighter__selector">
      <button data-cycle="${team}:-1" aria-label="Previous ${team} fighter">‹</button>
      <div><strong>${fighter.name}</strong><small>${fighter.tagline}</small></div>
      <button data-cycle="${team}:1" aria-label="Next ${team} fighter">›</button>
    </div>
    <button class="select" data-select="${team}">SELECT ${team.toUpperCase()}</button>
  </section>`;
}

function selection(): void {
  app.innerHTML = `<main class="arena"><header><p class="eyebrow">HEADLINE WARS</p><h1>CHOOSE YOUR FIGHTER</h1><p>Pick a side. Call the headlines.</p></header>
    <div class="fighters">${panel("red")}<div class="versus">VS</div>${panel("blue")}</div>
    <p class="note">Choose the character that fits your outlook. You can change sides later.</p></main>`;
  app.querySelectorAll<HTMLElement>(".fighter").forEach((fighter) => {
    fighter.addEventListener("pointerenter", () => fighter.classList.add("is-previewing"));
    fighter.addEventListener("pointerleave", () => fighter.classList.remove("is-previewing"));
  });
  app.querySelectorAll<HTMLButtonElement>("[data-cycle]").forEach((button) => button.addEventListener("click", () => {
    const [team, delta] = button.dataset.cycle!.split(":") as [Team, string];
    index[team] = (index[team] + Number(delta) + fighters[team].length) % fighters[team].length;
    selection();
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((button) => button.addEventListener("click", () => choose(button.dataset.select as Team)));
}

function choose(team: Team): void {
  const fighter = fighters[team][index[team]];
  try { localStorage.setItem(key, fighter.id); } catch { /* Storage may be disabled. */ }
  app.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.disabled = true);
  const arena = app.querySelector(".arena");
  if (!arena) return;
  arena.classList.add("arena--selected", `arena--selected-${team}`);
  arena.querySelector(`.fighter--${team}`)?.classList.add("fighter--victory");
  arena.insertAdjacentHTML("beforeend", `<div class="welcome welcome--${team}" role="status"><strong>WELCOME TO TEAM ${team.toUpperCase()}</strong><span>${fighter.name}</span></div>`);
  window.setTimeout(() => home(fighter), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1750);
}

function home(fighter: Fighter): void {
  app.innerHTML = `<main class="home"><header class="top"><strong>HEADLINE WARS</strong><button id="change-side">Change side</button></header>
    <section class="scoreboard" aria-label="Team scoreboard"><p>HEADLINES WON</p>
      <div class="scores"><div><span>RED</span><strong data-score="red">-</strong></div><b>VS</b><div><span>BLUE</span><strong data-score="blue">-</strong></div></div>
    </section>
    <p class="identity">Playing as ${fighter.name} on Team ${fighter.team.toUpperCase()}</p>
    <p id="game-status" role="status"></p>
    <div id="game">Loading predictions.</div></main>`;
  const stop = startGame(
    app.querySelector<HTMLElement>("#game")!,
    app.querySelector<HTMLElement>(".scoreboard")!,
    app.querySelector<HTMLElement>("#game-status")!,
    fighter.team,
  );
  app.querySelector("#change-side")?.addEventListener("click", () => {
    stop();
    selection();
  });
}

const previous = remembered();
if (previous) {
  index[previous.team] = fighters[previous.team].findIndex((fighter) => fighter.id === previous.id);
  home(previous);
} else {
  selection();
}
