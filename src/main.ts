import { fighters, type Fighter, type Team } from "./fighters";
import { startGame } from "./game/play";
import "./styles.css";

const key = "headline-wars:fighter";
const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
const app = root;
const roster = Object.values(fighters).flat();
const party: Record<Team, string> = { red: "Republican", blue: "Democrat" };

function remembered(): Fighter | undefined {
  try {
    const id = localStorage.getItem(key);
    return roster.find((fighter) => fighter.id === id);
  } catch {
    return undefined;
  }
}

function panel(team: Team, chosen: Fighter): string {
  return `<fieldset class="team-picker team-picker--${team}">
    <legend>TEAM ${team.toUpperCase()} <small>${party[team]}</small></legend>
    ${fighters[team].map((fighter) => `<label class="fighter-option">
      <input type="radio" name="fighter" value="${fighter.id}" ${fighter === chosen ? "checked" : ""}>
      <span>${fighter.name.replace(/ (Republican|Democrat)$/, "")}</span>
    </label>`).join("")}
  </fieldset>`;
}

function selection(initial = remembered() ?? fighters.red[1]): void {
  let chosen = initial;
  app.innerHTML = `<main class="arena"><header>
    <div class="wordmark wordmark--arena" role="img" aria-label="Headline Wars"></div>
    <h1>CHOOSE YOUR FIGHTER</h1>
    </header>
    <form class="picker" aria-label="Choose your fighter">
      <div class="matchup">
        ${panel("red", chosen)}
        <div class="fight-art" role="img" aria-label="Red elephant and Blue donkey facing off in a boxing ring"></div>
        ${panel("blue", chosen)}
      </div>
      <p class="fighter-caption"><strong></strong><small></small></p>
      <button class="join" type="submit"></button>
    </form></main>`;
  const form = app.querySelector("form")!;
  const join = form.querySelector<HTMLButtonElement>(".join")!;
  function update() {
    form.dataset.team = chosen.team;
    form.querySelector(".fighter-caption strong")!.textContent = chosen.name;
    form.querySelector(".fighter-caption small")!.textContent = party[chosen.team];
    join.textContent = `Select ${chosen.name}`;
  }
  form.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "fighter") return;
    const selected = roster.find((fighter) => fighter.id === (event.target as HTMLInputElement).value);
    if (selected) { chosen = selected; update(); }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    choose(chosen);
  });
  update();
}

function choose(fighter: Fighter): void {
  try { localStorage.setItem(key, fighter.id); } catch { /* Storage may be disabled. */ }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    home(fighter);
    return;
  }
  const arena = app.querySelector<HTMLElement>(".arena")!;
  const stage = arena.querySelector<HTMLElement>("form")!;
  stage.inert = true;
  arena.insertAdjacentHTML("beforeend", `<section class="welcome welcome--${fighter.team}" role="status">
    <div class="welcome-art" aria-hidden="true"></div>
    <strong>WELCOME TO TEAM ${fighter.team.toUpperCase()}</strong><span>${fighter.name}</span>
  </section>`);
  window.setTimeout(() => home(fighter), 1400);
}

function home(fighter: Fighter): void {
  app.innerHTML = `<main class="home">
    <header class="top"><div class="wordmark" role="img" aria-label="Headline Wars"></div></header>
    <section class="scoreboard" aria-label="Headlines won by team">
      <div class="scores">
        <div class="score-panel score-panel--red"><span>RED TEAM</span><strong data-score="red">–</strong></div>
        <b aria-hidden="true">VS</b>
        <div class="score-panel score-panel--blue"><span>BLUE TEAM</span><strong data-score="blue">–</strong></div>
      </div>
      <p class="score-lead" data-score-lead>HEADLINES WON</p>
    </section>
    <div class="identity"><span>${fighter.name} · Team ${fighter.team.toUpperCase()}</span><button id="change-side">Change fighter</button></div>
    <p id="game-status" role="status"></p>
    <div id="game">Loading predictions.</div>
    <footer>One question a day · Real-world results</footer>
  </main>`;
  const stop = startGame(
    app.querySelector<HTMLElement>("#game")!,
    app.querySelector<HTMLElement>(".scoreboard")!,
    app.querySelector<HTMLElement>("#game-status")!,
    fighter.team,
  );
  app.querySelector("#change-side")?.addEventListener("click", () => {
    stop();
    selection(fighter);
  });
}

const previous = remembered();
if (previous) home(previous);
else selection();
