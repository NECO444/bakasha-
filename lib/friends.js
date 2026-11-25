import { metric } from "@vercel/functions";
import { getAuthenticatedAccount } from "./accounts.js";
import { HttpError } from "./http.js";
import {
  loadAccountRecord,
  loadFriendRecord,
  saveFriendRecord,
  withRoomLock,
} from "./store.js";

function friendSummary(record) {
  return {
    friends: record.friends.map(({ username }) => ({ username })),
    incoming: record.incoming.map(({ username }) => ({ username })),
    outgoing: record.outgoing.map(({ username }) => ({ username })),
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
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new HttpError(401, "Sign in to manage friends.");
    const result = await withRoomLock("friends", async () => {
      const current = await loadFriendRecord(account.id);
      if (request.method === "GET") return friendSummary(current);

      const username = cleanUsername(body.username);
      const other = await findAccount(username);
      if (other.id === account.id) throw new HttpError(400, "You cannot add yourself as a friend.");
      const otherRecord = await loadFriendRecord(other.id);
      const action = request.method === "DELETE" ? "remove" : body.action;

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
    metric("bakasha.friends.duration_ms", performance.now() - startedAt);
  }
}
