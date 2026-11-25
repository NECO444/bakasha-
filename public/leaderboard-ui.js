export async function renderLeaderboard({ period, callGameApi }) {
  const rows = document.querySelector("#leaderboard-rows");
  const status = document.querySelector("#leaderboard-status");
  const empty = document.querySelector("#leaderboard-empty");
  const pinned = document.querySelector("#leaderboard-pinned");
  const table = document.querySelector(".leaderboard-table-wrap");
  rows.replaceChildren();
  empty.classList.add("hidden");
  pinned.classList.add("hidden");
  status.textContent = "Loading standings…";

  try {
    const result = await callGameApi(`/api/leaderboard?period=${encodeURIComponent(period)}`);
    const playerCount = result.players.length;
    document.querySelector("#leaderboard-empty-copy").textContent =
      `Only ${playerCount} player${playerCount === 1 ? "" : "s"} ranked. Invite a friend to climb.`;
    empty.classList.toggle("hidden", playerCount >= 3);
    for (const player of result.players) {
      const row = document.createElement("tr");
      if (result.currentUser && player.username === result.currentUser.username) row.classList.add("is-current-player");
      for (const value of [player.rank, player.username, player.wins, player.losses, `${player.winRate}%`]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      rows.append(row);
    }

    if (result.currentUser && result.currentUser.rank > playerCount) {
      pinned.textContent = `Your rank: #${result.currentUser.rank} · ${result.currentUser.username} · ${result.currentUser.wins} wins`;
      pinned.classList.remove("hidden");
    }
    table.classList.toggle("hidden", playerCount === 0);
    status.textContent = playerCount
      ? `${period === "all-time" ? "All-time" : "Rolling 28-day"} standings · Updated ${new Date(result.updatedAt).toLocaleString()}`
      : period === "friends" ? "No ranked matches among your friends yet." : "No ranked matches yet.";
  } catch (error) {
    table.classList.add("hidden");
    status.textContent = (error && error.message) || "The leaderboard could not be loaded.";
  }
}
