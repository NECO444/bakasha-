import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";
import {
  LEADERBOARD_WINDOW_MS,
  loadLeaderboardMatches,
  recordLeaderboardMatch,
  recordPlayerProgress,
} from "./store.js";

async function measured(name, fn) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const result = await fn();
    outcome = "success";
    return result;
  } catch (error) {
    outcome = error instanceof HttpError ? "rejected" : "error";
    throw error;
  } finally {
    metric(`${name}.requests`, 1, { outcome });
    metric(`${name}.duration_ms`, performance.now() - startedAt);
  }
}

export async function recordRankedMatch(match) {
  return measured("bakasha.leaderboard.record", async () => {
    const progressStartedAt = performance.now();
    let progressOutcome = "error";
    try {
      const [leaderboardRecorded, progressRecorded] = await Promise.all([
        recordLeaderboardMatch(match),
        recordPlayerProgress(match),
      ]);
      progressOutcome = progressRecorded ? "recorded" : "duplicate";
      return { leaderboardRecorded, progressRecorded };
    } finally {
      metric("bakasha.player_progress.records", 1, { outcome: progressOutcome });
      metric("bakasha.player_progress.duration_ms", performance.now() - progressStartedAt, { outcome: progressOutcome });
    }
  });
}

export async function handleLeaderboard() {
  return measured("bakasha.leaderboard.read", async () => {
    const now = Date.now();
    const matches = await loadLeaderboardMatches(now);
    const players = new Map();
    for (const match of matches) {
      for (const player of match.players) {
        let record = players.get(player.id);
        if (!record) {
          record = { username: player.username, wins: 0, losses: 0 };
          players.set(player.id, record);
        }
        if (match.winnerId === player.id) record.wins += 1;
        else record.losses += 1;
      }
    }

    const standings = [...players.values()]
      .map((player) => ({
        ...player,
        games: player.wins + player.losses,
        winRate: player.wins + player.losses
          ? Math.round((player.wins / (player.wins + player.losses)) * 100)
          : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.username.localeCompare(b.username))
      .slice(0, 100)
      .map((player, index) => ({ rank: index + 1, ...player }));

    return {
      periodStart: new Date(now - LEADERBOARD_WINDOW_MS).toISOString(),
      updatedAt: new Date(now).toISOString(),
      players: standings,
    };
  });
}
