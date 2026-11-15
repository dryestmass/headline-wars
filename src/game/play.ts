import type { Ballot, Game, Question } from "./model";
import { questionSource } from "./question-source";
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
  const section = element("section", undefined, "predictions");
  section.append(element("h3", "Current predictions", "eyebrow"));
  const list = element("ul", undefined, "vote-results");
  let totalVotes = 0;
  for (const team of ["red", "blue"] as const) {
    const { yes, no } = question.votes[team];
    const total = yes + no;
    totalVotes += total;
    const percentage = total ? Math.round(100 * yes / total) : 0;
    const item = element("li", undefined, `team-tally team-tally--${team}`);
    const caption = element("div", undefined, "tally-caption");
    caption.append(element("strong", team.toUpperCase()),
      element("span", total ? `${percentage}% YES · ${100 - percentage}% NO` : "No votes yet"));
    const bar = element("div", undefined, "tally-track");
    bar.setAttribute("aria-hidden", "true");
    const fill = element("span");
    fill.style.width = `${percentage}%`;
    bar.append(fill);
    item.append(caption, bar);
    if (question.status === "resolved" && question.outcome && total) {
      const { correct } = accuracy(question.votes[team], question.outcome);
      item.append(element("small", `${correct} of ${total} correct`));
    }
    list.append(item);
  }
  const total = element("p", undefined, "total-votes");
  total.append(element("span", "Total votes", "eyebrow"), element("strong", totalVotes.toLocaleString()));
  section.append(list, total);
  return section;
}

function sourceLink(href: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  return link;
}

function receipt(ballot: Ballot): HTMLElement {
  const note = element("p", `You voted ${ballot.answer.toUpperCase()} for Team ${ballot.team === "red" ? "Red" : "Blue"}.`, "ballot-receipt");
  note.tabIndex = -1;
  return note;
}

function questionCard(question: Question, today: boolean): HTMLElement {
  const card = element(today ? "section" : "article", undefined, today ? "question" : "archive-entry");
  if (today) card.append(element("p", "TODAY'S PREDICTION", "eyebrow"));
  const source = questionSource(question.criteria);
  card.append(element(today ? "h1" : "h2", question.prompt), element("p", source.criteria));
  if (source.url) card.append(sourceLink(source.url, "Official floor schedule"));
  if (question.status === "open") {
    const deadline = new Date(question.closesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    card.append(element("p", `Voting closes ${deadline}`, "deadline"));
  }
  if (question.ballot) card.append(receipt(question.ballot));
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
          card.append(sourceLink(url.href, "Official result"));
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
  const confirmedBallots = new Map<string, Ballot>();

  function render(game: Game): void {
    const questions = game.questions.map((question) => ({
      ...question, ballot: question.ballot ?? confirmedBallots.get(question.id) ?? null,
    }));
    const today = questions.find((question) => question.status === "open");
    const panel = today ? questionCard(today, true) : element("section", "No prediction is open right now.", "question");
    if (today && !today.ballot) {
      if (!game.votingEnabled || !voter) {
        panel.append(element("p", voter ? "Voting is temporarily unavailable." : "Allow browser storage to vote."));
      } else {
        const choices = element("div", undefined, "choices");
        choices.setAttribute("role", "group");
        choices.setAttribute("aria-label", `Vote for Team ${team === "red" ? "Red" : "Blue"}`);
        for (const answer of ["yes", "no"] as const) {
          const button = document.createElement("button");
          button.textContent = answer.toUpperCase();
          button.dataset.answer = answer;
          button.disabled = submitting;
          button.addEventListener("click", () => void vote(today.id, answer));
          choices.append(button);
        }
        panel.insertBefore(choices, panel.querySelector(".predictions"));
      }
    }
    const archive = element("section", undefined, "archive");
    for (const [label, entries, empty] of [
      ["Pending Questions", questions.filter((q) => q.status === "closed"), "No questions awaiting verification."],
      ["Verified Results", questions.filter((q) => q.status === "resolved"), "No verified outcomes yet."],
    ] as const) {
      const list = document.createElement("details");
      list.open = Array.from(container.querySelectorAll("details[open]")).some((item) => (item as HTMLElement).dataset.archive === label);
      const heading = element("summary", label);
      heading.append(element("span", entries.length.toString(), "archive-count"));
      list.dataset.archive = label;
      list.append(heading);
      list.append(...(entries.length ? entries.map((entry) => questionCard(entry, false)) : [element("p", empty)]));
      archive.append(list);
    }

    const focused = document.activeElement;
    const answer = focused instanceof HTMLElement ? focused.dataset.answer : undefined;
    const summary = focused?.tagName === "SUMMARY" ? focused.parentElement?.dataset.archive : null;
    container.replaceChildren(panel, archive);
    if (focused?.classList.contains("ballot-receipt")) {
      container.querySelector<HTMLElement>(".question .ballot-receipt")?.focus({ preventScroll: true });
    }
    if (answer) (container.querySelector<HTMLElement>(`[data-answer="${answer}"]`) ??
      container.querySelector<HTMLElement>(".question .ballot-receipt"))?.focus({ preventScroll: true });
    if (summary) Array.from(container.querySelectorAll("summary")).find((item) => item.parentElement?.dataset.archive === summary)?.focus();
    const lead = score.querySelector("[data-score-lead]");
    if (lead) {
      const difference = game.scores.red - game.scores.blue;
      lead.textContent = difference === 0 ? "TEAMS TIED" :
        `${difference > 0 ? "RED" : "BLUE"} LEADS BY ${Math.abs(difference)} ${Math.abs(difference) === 1 ? "HEADLINE" : "HEADLINES"}`;
    }
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
      const result: { ballot?: Ballot; error?: string } = await response.json();
      if (result.ballot) {
        confirmedBallots.set(id, result.ballot);
        const choices = container.querySelector(".question .choices");
        if (choices) {
          const note = receipt(result.ballot);
          choices.replaceWith(note);
          note.focus({ preventScroll: true });
        }
      }
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
  const refreshVisible = () => {
    if (!document.hidden && !submitting) void requestRefresh();
  };
  document.addEventListener("visibilitychange", refreshVisible, { signal: lifetime.signal });
  const timer = window.setInterval(refreshVisible, 10000);
  return () => {
    lifetime.abort();
    window.clearInterval(timer);
  };
}
