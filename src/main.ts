import { mountSponsor } from "./game/sponsor";
import { fighters, type Fighter, type Team } from "./fighters";
import { sprite } from "./game/fighter-sprite";
import { startGame } from "./game/play";
import { listenForSounds, soundButton } from "./game/sound";
import "./styles.css";

const key = "headline-wars:fighter";
const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("Missing application root");
const app = root;
listenForSounds(app);
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
    <div class="sound-row">${soundButton()}</div>
    <div class="wordmark wordmark--arena" role="img" aria-label="Headline Wars"></div>
    <h1>CHOOSE YOUR FIGHTER</h1>
    </header>
    <form class="picker" aria-label="Choose your fighter">
      <div class="matchup">
        ${panel("red", chosen)}
        <div class="fight-art" role="img" aria-label="Red elephant and Blue donkey facing off in a boxing ring">
          ${sprite("red")}
          <div class="fighter-burst" aria-hidden="true">VS</div>
          ${sprite("blue")}
        </div>
        ${panel("blue", chosen)}
      </div>
      <div class="fighter-nameplate"><p class="fighter-caption"><strong></strong><small></small></p></div>
      <button class="join" type="submit"></button>
    </form></main>`;
  const form = app.querySelector("form")!;
  const join = form.querySelector<HTMLButtonElement>(".join")!;
  const animations: Partial<Record<Team, Animation[]>> = {};
  function react(team: Team) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const guard = form.querySelector<HTMLElement>(`.fighter-sprite--${team} .fighter-pose--guard`);
    const jab = form.querySelector<HTMLElement>(`.fighter-sprite--${team} .fighter-pose--jab`);
    if (!guard?.animate || !jab?.animate) return;
    animations[team]?.forEach((animation) => animation.cancel());
    const timing = { duration: 380 };
    animations[team] = [
      guard.animate([
        { opacity: 1, offset: 0, easing: "steps(1, end)" },
        { opacity: 0, offset: .24, easing: "steps(1, end)" },
        { opacity: 1, offset: .65 },
      ], timing),
      jab.animate([
        { opacity: 0, offset: 0, easing: "steps(1, end)" },
        { opacity: 1, offset: .24, easing: "steps(1, end)" },
        { opacity: 0, offset: .65 },
      ], timing),
    ];
  }
  function update() {
    form.dataset.team = chosen.team;
    form.querySelector(".fighter-caption strong")!.textContent = chosen.name;
    form.querySelector(".fighter-caption small")!.textContent = party[chosen.team];
    join.textContent = `Select ${chosen.name}`;
  }
  form.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "fighter") return;
    const selected = roster.find((fighter) => fighter.id === (event.target as HTMLInputElement).value);
    if (selected) {
      chosen = selected;
      update();
      react(chosen.team);
    }
  });
  form.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.name === "fighter" && target.value === chosen.id) {
      react(chosen.team);
    }
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
    <div class="welcome-art" aria-hidden="true">${sprite(fighter.team)}</div>
    <strong>WELCOME TO TEAM ${fighter.team.toUpperCase()}</strong><span>${fighter.name}</span>
  </section>`);
  window.setTimeout(() => home(fighter), 1400);
}

function home(fighter: Fighter): void {
  app.innerHTML = `<main class="home">
    <header class="top"><div class="sound-row">${soundButton()}</div><div class="wordmark" role="img" aria-label="Headline Wars"></div></header>
    <button type="button" class="vote-shortcut" id="vote-shortcut" hidden>Vote now <span aria-hidden="true">↓</span></button>
    <section class="scoreboard" aria-label="Headlines won by team">
      <div class="scores">
        <div class="score-panel score-panel--red"><span>RED TEAM</span><strong data-score="red">–</strong></div>
        <b aria-hidden="true"><span>VS</span></b>
        <div class="score-panel score-panel--blue"><span>BLUE TEAM</span><strong data-score="blue">–</strong></div>
      </div>
      <p class="score-lead" data-score-lead>HEADLINES WON</p>
      <p class="score-feedback" data-score-feedback role="status"></p>
    </section>
    <div class="identity"><span>${fighter.name} · Team ${fighter.team.toUpperCase()}</span><button id="change-side">Change fighter</button></div>
    <p id="game-status" role="status"></p>
    <div id="game">Loading predictions.</div>
    <aside class="sponsor" aria-label="Advertisement" hidden></aside>
    <section class="game-rules">
      <details>
        <summary>How it works</summary>
        <ol>
          <li>Choose a fighter to join Team Red or Team Blue. No account is needed.</li>
          <li>The daily question is scheduled to switch at 3 p.m. Eastern / noon Pacific. Voting usually closes at the switch. Some questions close earlier, so check the deadline shown on the question.</li>
          <li>Vote YES or NO before the deadline. You get one vote per question in this browser, and it locks in when you confirm.</li>
          <li>After voting closes, the question stays in Pending Questions until the outcome can be verified. Verified Results links to the source.</li>
          <li>The team with the higher percentage of correct votes earns one headline. Ties award no point, and a team needs at least one vote to be eligible.</li>
        </ol>
      </details>
    </section>
  </main>`;
  mountSponsor(app.querySelector<HTMLElement>(".sponsor")!);
  const stop = startGame(
    app.querySelector<HTMLElement>("#game")!,
    app.querySelector<HTMLElement>(".scoreboard")!,
    app.querySelector<HTMLElement>("#game-status")!,
    fighter.team,
    app.querySelector<HTMLButtonElement>("#vote-shortcut")!,
  );
  app.querySelector("#change-side")?.addEventListener("click", () => {
    stop();
    selection(fighter);
  });
}

const previous = remembered();
if (previous) home(previous);
else selection();
