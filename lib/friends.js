import { randomUUID } from "node:crypto";
import { metric } from "@vercel/functions";
import { getAuthenticatedAccount } from "./accounts.js";
import { HttpError } from "./http.js";
import {
  loadAccountRecord,
  loadFriendRecord,
  loadRoom,
  loadOnlinePresence,
  saveFriendRecord,
  withRoomLock,
} from "./store.js";

const ROOM_CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

function friendSummary(record, presence = new Map()) {
  return {
    friends: record.friends.map(({ id, username }) => ({ username, online: presence.get(id) === true })),
    incoming: record.incoming.map(({ username }) => ({ username })),
    outgoing: record.outgoing.map(({ username }) => ({ username })),
    challenges: record.challenges.map(({ id, roomCode, fromUsername, createdAt }) => ({
      id,
      roomCode,
      fromUsername,
      createdAt,
    })),
  };
}

function cleanUsername(value) {
  if (typeof value !== "string") throw new HttpError(400, "Enter a username.");
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,16}$/.test(username)) {
    throw new HttpError(400, "Enter a valid username (3–16 letters, numbers, or underscores).");
  }
  return username;
}

function removeById(list, id) {
  return list.filter((entry) => entry.id !== id);
}

async function findAccount(username) {
  const account = await loadAccountRecord(username);
  if (!account) throw new HttpError(404, "No account was found with that username.");
  return { id: account.id, username: account.username };
}

export async function handleFriends({ request, body }) {
  const startedAt = performance.now();
  let outcome = "error";
  let challengeAction = false;
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new HttpError(401, "Sign in to manage friends.");
    const result = await withRoomLock("friends", async () => {
      const current = await loadFriendRecord(account.id);
      if (request.method === "GET") {
        const now = Date.now();
        const activeChallenges = current.challenges.filter(
          (entry) => Number.isFinite(entry.createdAt) && now - entry.createdAt < CHALLENGE_TTL_MS,
        );
        if (activeChallenges.length !== current.challenges.length) {
          current.challenges = activeChallenges;
          await saveFriendRecord(account.id, current);
        }
        const presence = await loadOnlinePresence(current.friends.map(({ id }) => id));
        return friendSummary(current, presence);
      }

      const action = request.method === "DELETE" ? "remove" : body.action;
      challengeAction = action === "challenge";
      if (action === "dismiss-challenge") {
        const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
        const challengeIndex = current.challenges.findIndex((challenge) => challenge.id === challengeId);
        if (challengeIndex < 0) throw new HttpError(404, "That game invitation is no longer available.");
        current.challenges.splice(challengeIndex, 1);
        await saveFriendRecord(account.id, current);
        return friendSummary(current);
      }

      const username = cleanUsername(body.username);
      if (action === "challenge") {
        const friend = current.friends.find((entry) => entry.username === username);
        if (!friend) throw new HttpError(403, "You can only invite someone on your friends list.");
        const otherRecord = await loadFriendRecord(friend.id);
        if (!otherRecord.friends.some((entry) => entry.id === account.id)) {
          throw new HttpError(409, "You are no longer friends with that player.");
        }
        const roomCode = typeof body.roomCode === "string" ? body.roomCode.toUpperCase() : "";
        if (!ROOM_CODE_RE.test(roomCode)) throw new HttpError(400, "The duel room is invalid.");
        const now = Date.now();
        const challenge = await withRoomLock(roomCode, async () => {
          const room = await loadRoom(roomCode);
          if (!room) throw new HttpError(404, "That duel room has expired.");
          if (
            room.isPublic === true
            || room.status !== "waiting"
            || (room.maxPlayers || 2) !== 2
            || room.players.length !== 1
            || room.players[0].accountId !== account.id
          ) {
            throw new HttpError(409, "Create a new private duel before inviting your friend.");
          }
          const activeChallenges = otherRecord.challenges.filter(
            (entry) => Number.isFinite(entry.createdAt) && now - entry.createdAt < CHALLENGE_TTL_MS,
          );
          const existing = activeChallenges.find((entry) => entry.roomCode === roomCode);
          if (existing) return existing;
          const nextChallenge = {
            id: randomUUID(),
            roomCode,
            fromAccountId: account.id,
            fromUsername: account.username,
            createdAt: now,
          };
          otherRecord.challenges = [...activeChallenges, nextChallenge];
          await saveFriendRecord(friend.id, otherRecord);
          return nextChallenge;
        });
        return { ...friendSummary(current), sentChallenge: { id: challenge.id, username, roomCode } };
      }

      const other = await findAccount(username);
      if (other.id === account.id) throw new HttpError(400, "You cannot add yourself as a friend.");
      const otherRecord = await loadFriendRecord(other.id);

      if (action === "request") {
        if (current.friends.some((entry) => entry.id === other.id)) {
          throw new HttpError(409, "You are already friends.");
        }
        if (current.incoming.some((entry) => entry.id === other.id)) {
          throw new HttpError(409, "They already sent you a request. Accept it from incoming requests.");
        }
        if (current.outgoing.some((entry) => entry.id === other.id)) {
          throw new HttpError(409, "A friend request is already pending.");
        }
        current.outgoing.push(other);
        otherRecord.incoming.push({ id: account.id, username: account.username });
      } else if (action === "accept" || action === "decline") {
        if (!current.incoming.some((entry) => entry.id === other.id)) {
          throw new HttpError(404, "That incoming friend request was not found.");
        }
        current.incoming = removeById(current.incoming, other.id);
        otherRecord.outgoing = removeById(otherRecord.outgoing, account.id);
        if (action === "accept") {
          current.friends.push(other);
          otherRecord.friends.push({ id: account.id, username: account.username });
        }
      } else if (action === "remove") {
        if (!current.friends.some((entry) => entry.id === other.id)) {
          throw new HttpError(404, "That friend was not found.");
        }
        current.friends = removeById(current.friends, other.id);
        otherRecord.friends = removeById(otherRecord.friends, account.id);
        current.challenges = current.challenges.filter((entry) => entry.fromAccountId !== other.id);
        otherRecord.challenges = otherRecord.challenges.filter((entry) => entry.fromAccountId !== account.id);
      } else {
        throw new HttpError(400, "Choose a friend request action.");
      }

      await saveFriendRecord(account.id, current);
      await saveFriendRecord(other.id, otherRecord);
      return friendSummary(current);
    });
    outcome = "success";
    return result;
  } catch (error) {
    outcome = error instanceof HttpError ? "rejected" : "error";
    throw error;
  } finally {
    metric("bakasha.friends.requests", 1, { outcome });
    if (challengeAction) metric("bakasha.friend_challenges.requests", 1, { outcome });
    metric("bakasha.friends.duration_ms", performance.now() - startedAt);
  }
}
