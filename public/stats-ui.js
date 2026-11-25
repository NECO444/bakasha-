function filterMatches(history, period) {
  if (period === "all") return history;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === "month") start.setDate(1);
  return history.filter((match) => Number.isFinite(match.finishedAt) && match.finishedAt >= start.getTime());
}

export function renderStats(progress, period) {
  const history = progress && Array.isArray(progress.history) ? progress.history : [];
  const matches = filterMatches(history, period)
    .slice()
    .sort((left, right) => right.finishedAt - left.finishedAt);
  const wins = matches.filter((match) => match.result === "win").length;
  const losses = matches.filter((match) => match.result === "loss").length;
  document.querySelector("#stats-wins").textContent = String(wins);
  document.querySelector("#stats-losses").textContent = String(losses);
  document.querySelector("#stats-played").textContent = String(matches.length);
  const list = document.querySelector("#match-history");
  list.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("li");
    empty.textContent = "No online matches in this period yet.";
    list.append(empty);
  }
  for (const match of matches.slice(0, 50)) {
    const item = document.createElement("li");
    const detail = document.createElement("div");
    const title = document.createElement("strong");
    const opponents = Array.isArray(match.opponents) ? match.opponents : [];
    title.textContent = opponents.length ? `vs ${opponents.join(", ")}` : "Online match";
    const date = document.createElement("time");
    date.dateTime = new Date(match.finishedAt).toISOString();
    date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(match.finishedAt));
    detail.append(title, date);
    const result = document.createElement("span");
    result.className = `match-result${match.result === "loss" ? " is-loss" : ""}`;
    result.textContent = match.result === "win" ? "WIN" : "LOSS";
    item.append(detail, result);
    list.append(item);
  }
}
