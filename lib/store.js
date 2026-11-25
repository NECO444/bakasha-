import { Redis } from "@upstash/redis";
import { randomUUID } from "node:crypto";
import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";

export const ROOM_TTL_SECONDS = 24 * 60 * 60; // rooms expire after 24h of inactivity
export const ACCOUNT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const LEADERBOARD_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
const LOGIN_FAILURE_TTL_SECONDS = 15 * 60;

// Local-only fallback so `npm test` and quick experiments work without Redis.
// It is never used on Vercel preview/production, where functions are stateless.
const mem = new Map();
const memory = {
  async get(key) {
    const entry = mem.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      mem.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  },
  async set(key, value, options = {}) {
    if (options.nx) {
      const entry = mem.get(key);
      if (entry && entry.expires >= Date.now()) return null;
      if (entry) mem.delete(key);
    }
    const ttl = options.px ?? (options.ex === undefined ? Infinity : options.ex * 1000);
    mem.set(key, { value: structuredClone(value), expires: Date.now() + ttl });
    return "OK";
  },
  async del(key) {
    mem.delete(key);
  },
};

let cached = null;
function db() {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    cached = new Redis({ url, token });
  } else if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new HttpError(503, "Storage is not set up. Add Upstash Redis to this Vercel project, then redeploy.");
  } else {
    cached = memory;
  }
  return cached;
}

const roomKey = (code) => `bakasha:room:${code}`;
const lockKey = (code) => `bakasha:lock:${code}`;
const accountKey = (username) => `bakasha:account:${username}`;
const activeRoomKey = (accountId) => `bakasha:active-room:${accountId}`;
const friendsKey = (accountId) => `bakasha:friends:${accountId}`;
const sessionKey = (tokenHash) => `bakasha:session:${tokenHash}`;
const loginFailuresKey = (username) => `bakasha:login-failures:${username}`;
const leaderboardKey = "bakasha:leaderboard:results";
const playerProgressKey = (accountId) => `bakasha:progress:${accountId}`;
const publicRoomsKey = "bakasha:public-rooms";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withActiveRoomMetric(action, operation) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const result = await operation();
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.active_room_index.operations", 1, { action, outcome });
    metric("bakasha.active_room_index.duration_ms", performance.now() - startedAt, { action });
  }
}

export async function loadRoom(code) {
  return (await db().get(roomKey(code))) || null;
}

export async function saveRoom(code, room) {
  await db().set(roomKey(code), room, { ex: ROOM_TTL_SECONDS });
}

function normalizeActiveRoomCodes(value) {
  if (value === null || value === undefined) return [];
  const codes = typeof value === "string" ? [value] : value;
  if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) {
    throw new Error("The active room index is invalid.");
  }
  return [...new Set(codes)];
}

export async function loadActiveRoomCodes(accountId) {
  return withActiveRoomMetric("load", async () => (
    normalizeActiveRoomCodes(await db().get(activeRoomKey(accountId)))
  ));
}

export async function saveActiveRoomCodes(accountId, codes) {
  return withActiveRoomMetric("save", async () => {
    const normalized = normalizeActiveRoomCodes(codes);
    if (normalized.length) await db().set(activeRoomKey(accountId), normalized);
    else await db().del(activeRoomKey(accountId));
  });
}

export async function saveActiveRoomCode(accountId, code) {
  return withActiveRoomMetric("add", async () => {
    const key = activeRoomKey(accountId);
    const codes = normalizeActiveRoomCodes(await db().get(key));
    if (!codes.includes(code)) codes.push(code);
    await db().set(key, codes);
  });
}

export async function clearActiveRoomCode(accountId, code = null) {
  return withActiveRoomMetric(code ? "remove" : "clear", async () => {
    const key = activeRoomKey(accountId);
    if (!code) {
      await db().del(key);
      return;
    }
    const codes = normalizeActiveRoomCodes(await db().get(key));
    const remaining = codes.filter((activeCode) => activeCode !== code);
    if (remaining.length) await db().set(key, remaining);
    else await db().del(key);
  });
}

export async function loadPublicRoomCodes() {
  const codes = await db().get(publicRoomsKey);
  if (codes === null) return [];
  if (!Array.isArray(codes) || codes.some((code) => typeof code !== "string")) {
    throw new Error("The public room index is invalid.");
  }
  return codes;
}

export async function savePublicRoomCodes(codes) {
  await db().set(publicRoomsKey, codes, { ex: ROOM_TTL_SECONDS });
}

export async function createAccountRecord(username, account) {
  return (await db().set(accountKey(username), account, { nx: true })) === "OK";
}

export async function loadAccountRecord(username) {
  return (await db().get(accountKey(username))) || null;
}

export async function loadFriendRecord(accountId) {
  const record = (await db().get(friendsKey(accountId))) || {};
  return {
    friends: Array.isArray(record.friends) ? record.friends : [],
    incoming: Array.isArray(record.incoming) ? record.incoming : [],
    outgoing: Array.isArray(record.outgoing) ? record.outgoing : [],
    challenges: Array.isArray(record.challenges) ? record.challenges : [],
  };
}

export async function saveFriendRecord(accountId, record) {
  await db().set(friendsKey(accountId), record);
}

export async function saveAccountSession(tokenHash, session) {
  await db().set(sessionKey(tokenHash), session, { ex: ACCOUNT_SESSION_TTL_SECONDS });
}

export async function loadAccountSession(tokenHash) {
  return (await db().get(sessionKey(tokenHash))) || null;
}

export async function deleteAccountSession(tokenHash) {
  await db().del(sessionKey(tokenHash));
}

export async function withLoginLock(username, fn) {
  return withRoomLock(`login:${username}`, fn);
}

export async function loadLoginFailures(username) {
  return (await db().get(loginFailuresKey(username))) || null;
}

export async function saveLoginFailures(username, failures) {
  await db().set(loginFailuresKey(username), failures, { ex: LOGIN_FAILURE_TTL_SECONDS });
}

export async function clearLoginFailures(username) {
  await db().del(loginFailuresKey(username));
}

function emptyPlayerProgress(username) {
  return {
    username,
    xp: 0,
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
    tutorialCompleted: false,
    history: [],
  };
}

function normalizePlayerProgress(progress, username) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) {
    throw new Error("The player progress record is invalid.");
  }
  for (const field of ["xp", "wins", "losses", "streak", "bestStreak"]) {
    if (!Number.isSafeInteger(progress[field]) || progress[field] < 0) {
      throw new Error(`The player progress ${field} is invalid.`);
    }
  }
  if (!Array.isArray(progress.history)) throw new Error("The player match history is invalid.");
  if (progress.history.some((entry) => (
    !entry
    || typeof entry.gameId !== "string"
    || !Number.isFinite(entry.finishedAt)
    || !["win", "loss"].includes(entry.result)
    || !Array.isArray(entry.opponents)
    || entry.opponents.some((opponent) => typeof opponent !== "string")
  ))) {
    throw new Error("A player match history entry is invalid.");
  }
  return {
    ...progress,
    username,
    tutorialCompleted: progress.tutorialCompleted === true,
  };
}

async function loadPlayerProgressRecord(accountId, username) {
  const stored = await db().get(playerProgressKey(accountId));
  return stored === null
    ? emptyPlayerProgress(username)
    : normalizePlayerProgress(stored, username);
}

export async function loadPlayerProgress(accountId, username) {
  return loadPlayerProgressRecord(accountId, username);
}

export async function completePlayerTutorial(accountId, username) {
  return withRoomLock(`player-progress:${accountId}`, async () => {
    const progress = await loadPlayerProgressRecord(accountId, username);
    progress.tutorialCompleted = true;
    await db().set(playerProgressKey(accountId), progress);
    return progress;
  });
}

export async function recordPlayerProgress(match) {
  if (
    !match
    || typeof match.gameId !== "string"
    || !Number.isFinite(match.finishedAt)
    || !Array.isArray(match.players)
    || match.players.length < 2
    || !match.players.some((player) => player.id === match.winnerId)
  ) {
    throw new Error("The completed match is invalid.");
  }
  const ids = match.players.map((player) => player.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw new Error("The completed match players are invalid.");
  }

  let recorded = false;
  for (const player of match.players) {
    if (typeof player.username !== "string" || !player.username) {
      throw new Error("The completed match player name is invalid.");
    }
    const updated = await withRoomLock(`player-progress:${player.id}`, async () => {
      const progress = await loadPlayerProgressRecord(player.id, player.username);
      if (progress.history.some((entry) => entry.gameId === match.gameId)) return false;

      const won = player.id === match.winnerId;
      const opponents = match.players
        .filter((opponent) => opponent.id !== player.id)
        .map((opponent) => opponent.username);
      progress.xp += 2 + (won ? 10 : 0);
      progress.wins += won ? 1 : 0;
      progress.losses += won ? 0 : 1;
      progress.streak = won ? progress.streak + 1 : 0;
      progress.bestStreak = Math.max(progress.bestStreak, progress.streak);
      progress.history.push({
        gameId: match.gameId,
        finishedAt: match.finishedAt,
        result: won ? "win" : "loss",
        opponents,
      });
      await db().set(playerProgressKey(player.id), progress);
      return true;
    });
    recorded = updated || recorded;
  }
  return recorded;
}

// Returns true if the room was created, false if the code was already taken.
export async function createRoomRecord(code, room) {
  const result = await db().set(roomKey(code), room, { nx: true, ex: ROOM_TTL_SECONDS });
  return result === "OK";
}

// Serialises writes to one room so two simultaneous requests cannot overwrite each other.
export async function withRoomLock(code, fn) {
  const client = db();
  const id = randomUUID();
  let locked = false;
  for (let attempt = 0; attempt < 25 && !locked; attempt += 1) {
    locked = (await client.set(lockKey(code), id, { nx: true, px: 5000 })) === "OK";
    if (!locked) await sleep(80);
  }
  if (!locked) throw new HttpError(503, "The room is busy. Try again in a moment.");
  try {
    return await fn();
  } finally {
    await client.del(lockKey(code));
  }
}

export async function recordLeaderboardMatch(match, now = Date.now()) {
  return withRoomLock("leaderboard", async () => {
    const cutoff = now - LEADERBOARD_WINDOW_MS;
    if (match.finishedAt < cutoff) return false;
    const matches = (await db().get(leaderboardKey)) || [];
    const recent = matches.filter((entry) => entry.finishedAt >= cutoff);
    if (recent.some((entry) => entry.gameId === match.gameId)) return false;
    recent.push(match);
    await db().set(leaderboardKey, recent, { ex: LEADERBOARD_WINDOW_MS / 1000 });
    return true;
  });
}

export async function loadLeaderboardMatches(now = Date.now()) {
  const cutoff = now - LEADERBOARD_WINDOW_MS;
  const matches = (await db().get(leaderboardKey)) || [];
  return matches.filter((entry) => entry.finishedAt >= cutoff);
}
