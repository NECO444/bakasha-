import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";
import { getAuthenticatedAccount } from "./accounts.js";
import { loadFriendRecord } from "./store.js";
import {
  LEADERBOARD_WINDOW_MS,
  loadLeaderboardMatches,
  loadAllTimeLeaderboardStats,
  loadCachedLeaderboardStandings,
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

function rankPlayers(players) {
  return players
    .map((player) => ({
      ...player,
      games: player.wins + player.losses,
      winRate: player.wins + player.losses
        ? Math.round((player.wins / (player.wins + player.losses)) * 100)
        : 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.username.localeCompare(b.username))
    .map((player, index) => ({ rank: index + 1, ...player }));
}

async function loadRankedPlayers(period, now) {
  const load = async () => {
    if (period === "all-time") return rankPlayers(await loadAllTimeLeaderboardStats());
    const matches = await loadLeaderboardMatches(now);
    const totals = new Map();
    for (const match of matches) {
      for (const player of match.players) {
        let record = totals.get(player.id);
        if (!record) {
          record = { id: player.id, username: player.username, wins: 0, losses: 0 };
          totals.set(player.id, record);
        }
        if (match.winnerId === player.id) record.wins += 1;
        else record.losses += 1;
      }
    }
    return rankPlayers([...totals.values()]);
  };
  return process.env.VERCEL_ENV
    ? loadCachedLeaderboardStandings(period, load)
    : load();
}

export async function handleLeaderboard({ request } = {}) {
  return measured("bakasha.leaderboard.read", async () => {
    const now = Date.now();
    const requestedPeriod = request ? new URL(request.url).searchParams.get("period") || "weekly" : "weekly";
    if (!["weekly", "all-time", "friends"].includes(requestedPeriod)) {
      throw new HttpError(400, "Choose the weekly, all-time, or friends leaderboard.");
    }

    const account = request ? await getAuthenticatedAccount(request) : null;
    let friends = null;
    if (requestedPeriod === "friends") {
      if (!account) throw new HttpError(401, "Sign in to view your friends leaderboard.");
      friends = await loadFriendRecord(account.id);
    }
    const rankedPlayers = await loadRankedPlayers(requestedPeriod === "friends" ? "weekly" : requestedPeriod, now);
    const friendIds = friends && new Set([account.id, ...friends.friends.map((friend) => friend.id)]);
    const fullStandings = friends
      ? rankPlayers(rankedPlayers.filter((player) => friendIds.has(player.id)))
      : rankedPlayers;
    const currentUserRecord = account
      ? fullStandings.find((player) => player.id === account.id) || null
      : null;
    const publicPlayer = ({ id, ...player }) => player;

    return {
      period: requestedPeriod,
      periodStart: requestedPeriod === "all-time" ? null : new Date(now - LEADERBOARD_WINDOW_MS).toISOString(),
      updatedAt: new Date(now).toISOString(),
      players: fullStandings.slice(0, 100).map(publicPlayer),
      currentUser: currentUserRecord ? publicPlayer(currentUserRecord) : null,
    };
  });
}
