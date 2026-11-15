import type { Ballot, Game, Question } from "./model";
import { accuracy, type Answer, type Team } from "./scoring";

const voterKey = "headline-wars:voter";

function browserVoter(): string | null {
  try {
    const stored = localStorage.getItem(voterKey);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(voterKey, id);
    return id;
  } catch {
    return null;
  }
}

function element(tag: string, text?: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function results(question: Question): HTMLElement {
  const list = element("ul", undefined, "vote-results");
  for (const team of ["red", "blue"] as const) {
    const { yes, no } = question.votes[team];
    const summary = element("li", `Team ${team === "red" ? "Red" : "Blue"}: ${yes} YES, ${no} NO`);
    if (question.status === "resolved" && question.outcome) {
      const { correct, total } = accuracy(question.votes[team], question.outcome);
      summary.append(total ? ` (${correct} of ${total} correct)` : " (no votes)");
    }
    list.append(summary);
  }
  return list;
}

function questionCard(question: Question, today: boolean): HTMLElement {
  const card = element(today ? "section" : "article", undefined, today ? "question" : "archive-entry");
  if (today) card.append(element("p", "TODAY'S PREDICTION", "eyebrow"));
  card.append(element(today ? "h1" : "h2", question.prompt), element("p", question.criteria));
  if (question.status === "open") {
    const deadline = new Date(question.closesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    card.append(element("p", `Voting closes ${deadline}`));
  }
  if (question.ballot) {
    card.append(element("p", `You voted ${question.ballot.answer.toUpperCase()} for Team ${question.ballot.team.toUpperCase()}.`));
  }
  if (question.status === "closed") card.append(element("p", "Voting closed. Awaiting verification."));
  if (question.status === "resolved") {
    const result = question.winner === "red" || question.winner === "blue"
      ? `Team ${question.winner.toUpperCase()} wins`
      : question.winner === "tie" ? "Tie" : "No point awarded";
    card.append(element("p", `Verified outcome: ${question.outcome?.toUpperCase()}. ${result}.`));
    if (question.sourceUrl) {
      try {
        const url = new URL(question.sourceUrl);
        if (url.protocol === "https:" || url.protocol === "http:") {
          const link = document.createElement("a");
          link.href = url.href;
          link.textContent = "Verification source";
          card.append(link);
        }
      } catch { /* Skip malformed legacy source URLs. */ }
    }
  }
  card.append(results(question));
  return card;
}

export function startGame(container: HTMLElement, score: HTMLElement, status: HTMLElement, team: Team): () => void {
  const lifetime = new AbortController();
  const voter = browserVoter();
  const headers: Record<string, string> = voter ? { "X-Voter-Id": voter } : {};
  let snapshot = "";
  let pendingRefresh: Promise<void> | undefined;
  let submitting = false;

  function render(game: Game): void {
    const today = game.questions.find((question) => question.status === "open");
    const panel = today ? questionCard(today, true) : element("section", "No prediction is open right now.", "question");
    if (today && !today.ballot) {
      if (!game.votingEnabled || !voter) {
        panel.append(element("p", voter ? "Voting is temporarily unavailable." : "Allow browser storage to vote."));
      } else {
        const choices = element("div", undefined, "choices");
        for (const answer of ["yes", "no"] as const) {
          const button = document.createElement("button");
          button.textContent = answer.toUpperCase();
          button.dataset.answer = answer;
          button.disabled = submitting;
          button.addEventListener("click", () => void vote(today.id, answer));
          choices.append(button);
        }
        panel.append(choices);
      }
    }
    const archive = element("section", undefined, "archive");
    for (const [label, entries, empty] of [
      ["Pending Questions", game.questions.filter((q) => q.status === "closed"), "No questions awaiting verification."],
      ["Verified Results", game.questions.filter((q) => q.status === "resolved"), "No verified outcomes yet."],
    ] as const) {
      const list = document.createElement("details");
      list.open = Array.from(container.querySelectorAll("details[open]")).some((item) => item.firstElementChild?.textContent === label);
      list.append(element("summary", label));
      list.append(...(entries.length ? entries.map((entry) => questionCard(entry, false)) : [element("p", empty)]));
      archive.append(list);
    }

    const focused = document.activeElement;
    const answer = focused instanceof HTMLElement ? focused.dataset.answer : undefined;
    const summary = focused?.tagName === "SUMMARY" ? focused.textContent : null;
    container.replaceChildren(panel, archive);
    if (answer) container.querySelector<HTMLElement>(`[data-answer="${answer}"]`)?.focus();
    if (summary) Array.from(container.querySelectorAll("summary")).find((item) => item.textContent === summary)?.focus();
    for (const side of ["red", "blue"] as const) {
      const total = score.querySelector(`[data-score="${side}"]`);
      if (total) total.textContent = String(game.scores[side]);
    }
  }

  async function refresh(): Promise<void> {
    if (lifetime.signal.aborted) return;
    try {
      const response = await fetch("/api/game", { headers, signal: lifetime.signal });
      if (!response.ok) throw new Error("Game unavailable");
      const game: Game = await response.json();
      const next = JSON.stringify(game);
      if (next !== snapshot) {
        render(game);
        snapshot = next;
      }
      if (status.dataset.refreshError) {
        delete status.dataset.refreshError;
        status.textContent = "";
      }
    } catch {
      if (!lifetime.signal.aborted) {
        status.dataset.refreshError = "true";
        status.textContent = "Could not load updates. Retrying shortly.";
        if (!snapshot) container.textContent = "";
      }
    }
  }

  function requestRefresh(): Promise<void> {
    pendingRefresh ??= refresh().finally(() => { pendingRefresh = undefined; });
    return pendingRefresh;
  }

  async function vote(id: string, answer: Answer): Promise<void> {
    if (submitting) return;
    submitting = true;
    container.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.disabled = true);
    delete status.dataset.refreshError;
    status.textContent = "";
    try {
      const response = await fetch(`/api/questions/${encodeURIComponent(id)}/vote`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ team, answer } satisfies Ballot),
        signal: lifetime.signal,
      });
      const result = await response.json();
      status.textContent = response.ok ? "Vote recorded." : result.error ?? "Could not submit your vote.";
    } catch {
      if (!lifetime.signal.aborted) status.textContent = "Could not confirm your vote. You can safely retry.";
    } finally {
      await pendingRefresh;
      await requestRefresh();
      submitting = false;
      container.querySelectorAll<HTMLButtonElement>("button").forEach((button) => button.disabled = false);
    }
  }

  void requestRefresh();
  const timer = window.setInterval(() => {
    if (!document.hidden && !submitting) void requestRefresh();
  }, 10000);
  return () => {
    lifetime.abort();
    window.clearInterval(timer);
  };
}
