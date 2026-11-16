type Cue = "tap" | "red" | "blue" | "join" | "yes" | "no" | "open" | "close" | "vote-submit" | "vote-locked";

interface Note {
  frequency: number;
  start: number;
  duration: number;
  level: number;
  wave?: OscillatorType;
}

const cues: Record<Cue, Note[]> = {
  tap: [{ frequency: 520, start: 0, duration: .07, level: .055, wave: "triangle" }],
  red: [
    { frequency: 164, start: 0, duration: .10, level: .09, wave: "triangle" },
    { frequency: 329, start: .025, duration: .075, level: .043, wave: "square" },
  ],
  blue: [
    { frequency: 220, start: 0, duration: .10, level: .083, wave: "triangle" },
    { frequency: 440, start: .025, duration: .075, level: .04, wave: "square" },
  ],
  join: [
    { frequency: 262, start: 0, duration: .13, level: .060, wave: "square" },
    { frequency: 392, start: .055, duration: .15, level: .050, wave: "triangle" },
    { frequency: 523, start: .115, duration: .19, level: .073, wave: "triangle" },
  ],
  yes: [
    { frequency: 392, start: 0, duration: .085, level: .07, wave: "triangle" },
    { frequency: 587, start: .055, duration: .11, level: .065, wave: "triangle" },
  ],
  no: [
    { frequency: 330, start: 0, duration: .085, level: .07, wave: "triangle" },
    { frequency: 262, start: .055, duration: .11, level: .065, wave: "triangle" },
  ],
  "vote-submit": [
    { frequency: 185, start: 0, duration: .12, level: .085, wave: "triangle" },
    { frequency: 740, start: .018, duration: .055, level: .035, wave: "square" },
  ],
  "vote-locked": [
    { frequency: 98, start: 0, duration: .17, level: .14, wave: "triangle" },
    { frequency: 392, start: .055, duration: .13, level: .055, wave: "square" },
    { frequency: 494, start: .125, duration: .16, level: .06, wave: "triangle" },
    { frequency: 587, start: .195, duration: .23, level: .07, wave: "triangle" },
    { frequency: 784, start: .195, duration: .34, level: .08, wave: "triangle" },
  ],
  open: [
    { frequency: 392, start: 0, duration: .07, level: .045, wave: "triangle" },
    { frequency: 523, start: .037, duration: .09, level: .045, wave: "triangle" },
  ],
  close: [
    { frequency: 523, start: 0, duration: .07, level: .045, wave: "triangle" },
    { frequency: 392, start: .037, duration: .09, level: .045, wave: "triangle" },
  ],
};

const storageKey = "headline-wars:sound";
let enabled = true;
try { enabled = localStorage.getItem(storageKey) !== "off"; } catch { /* Storage may be disabled. */ }
let audio: AudioContext | undefined;

function play(cue: Cue): void {
  if (!enabled || typeof AudioContext === "undefined") return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => undefined);
    const now = audio.currentTime;
    for (const note of cues[cue]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = now + note.start;
      oscillator.type = note.wave ?? "sine";
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(.001, start);
      gain.gain.exponentialRampToValueAtTime(note.level, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + note.duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start);
      oscillator.stop(start + note.duration);
    }
  } catch { /* Sound availability must never block gameplay. */ }
}

export function playVoteLocked(): void {
  play("vote-locked");
}

export function soundButton(): string {
  return `<button class="sound-toggle" type="button" aria-label="Sound effects" aria-pressed="${enabled}">Sound ${enabled ? "on" : "off"}</button>`;
}

export function listenForSounds(container: HTMLElement): void {
  container.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("button, summary, input[name=fighter]");
    if (!control || control.matches(":disabled")) return;
    if (control.matches(".sound-toggle")) {
      enabled = !enabled;
      try { localStorage.setItem(storageKey, enabled ? "on" : "off"); } catch { /* Storage may be disabled. */ }
      control.textContent = `Sound ${enabled ? "on" : "off"}`;
      control.setAttribute("aria-pressed", String(enabled));
      play("open");
      return;
    }
    if (control.matches("[data-vote-confirm]")) play("vote-submit");
    else if (control.matches("[data-vote-back]")) play("close");
    else if (control.matches(".join")) play("join");
    else if (control.matches("[data-answer=yes]")) play("yes");
    else if (control.matches("[data-answer=no]")) play("no");
    else if (control.matches("summary")) play(control.parentElement?.hasAttribute("open") ? "close" : "open");
    else if (control.matches("input[name=fighter]")) play(control.closest(".team-picker--red") ? "red" : "blue");
    else play("tap");
  }, { capture: true });
}
