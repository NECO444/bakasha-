import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";
import { getAuthenticatedAccount } from "./accounts.js";
import { recordRankedMatch } from "./leaderboard.js";
import { applyAction, newGame, publicGame } from "./engine.js";
import { createRoomRecord, loadRoom, saveRoom, withRoomLock } from "./store.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const PRESENCE_ONLINE_WINDOW_MS = 30_000;
const PRESENCE_WRITE_INTERVAL_MS = 10_000;

const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

function newCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function cleanName(value) {
  const name = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 16) throw new HttpError(400, "Choose a name between 1 and 16 characters.");
  return name;
}

function bearer(request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  return match ? match[1] : null;
}

function codeFrom(request) {
  const match = /^\/api\/rooms\/([^/]+)/.exec(new URL(request.url).pathname);
  const code = match ? decodeURIComponent(match[1]).toUpperCase() : "";
  if (!CODE_RE.test(code)) throw new HttpError(400, "That room code is not valid.");
  return code;
}

function seatOf(room, token) {
  if (!token) return -1;
  const hash = hashToken(token);
  return room.players.findIndex((player) => player.tokenHash === hash);
}

async function mustLoad(code) {
  const room = await loadRoom(code);
  if (!room) throw new HttpError(404, "That room was not found or has expired.");
  return room;
}

function mustBePlayer(room, request) {
  const seat = seatOf(room, bearer(request));
  if (seat < 0) throw new HttpError(403, "You are not a player in this room.");
  return seat;
}

function bindAccount(room, seat, account, strict = false) {
  if (!account) return false;
  const player = room.players[seat];
  if (player.accountId) {
    if (strict && player.accountId !== account.id) {
      throw new HttpError(403, "This room seat belongs to a different account.");
    }
    return false;
  }
  if (!player.accountId && room.status !== "playing") {
    player.accountId = account.id;
    player.name = account.username;
    return true;
  }
  return false;
}

// Public table state plus only this player's own hand.
export function snapshot(room, seat, now = Date.now()) {
  const game = room.game;
  return {
    roomCode: room.code,
    seat,
    publicData: {
      status: room.status,
      players: room.players.map((player, index) => ({
        name: player.name,
        handCount: game ? game.hands[index].length : 0,
        online: Number.isFinite(player.lastSeenAt) && now - player.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS,
      })),
      version: room.version,
      lastMessage: room.lastMessage,
      serverNow: now,
      game: game ? publicGame(game) : null,
      rematchRequests: room.status === "finished" && Array.isArray(room.rematchRequests)
        ? room.rematchRequests
        : [false, false],
      chatMessages: room.status === "playing" && Array.isArray(room.chatMessages)
        ? room.chatMessages
        : [],
    },
    ownHand: game && seat >= 0 ? game.hands[seat] : [],
  };
}

export async function handleCreate({ request, body }) {
  const account = await getAuthenticatedAccount(request);
  const name = account ? account.username : cleanName(body.name);
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = newCode();
    const room = {
      code,
      status: "waiting",
      players: [{
        name,
        tokenHash: hashToken(token),
        lastSeenAt: now,
        accountId: account ? account.id : null,
      }],
      game: null,
      gameId: null,
      chatMessages: [],
      rematchRequests: [false, false],
      version: 1,
      lastActionId: null,
      lastMessage: null,
    };
    if (await createRoomRecord(code, room)) return { ...snapshot(room, 0), token };
  }
  throw new HttpError(503, "Could not create a room. Please try again.");
}

export async function handleJoin({ request, body }) {
  const code = codeFrom(request);
  return withRoomLock(code, async () => {
    const room = await mustLoad(code);
    const existing = seatOf(room, typeof body.token === "string" ? body.token : null);
    if (existing >= 0) {
      const player = room.players[existing];
      const account = await getAuthenticatedAccount(request);
      if (room.status !== "playing") bindAccount(room, existing, account, true);
      player.lastSeenAt = Date.now();
      await saveRoom(code, room);
      return snapshot(room, existing); // reconnecting
    }
    if (room.players.length >= 2) throw new HttpError(403, "This room already has two players.");
    const account = await getAuthenticatedAccount(request);
    const name = account ? account.username : cleanName(body.name);
    const token = randomBytes(24).toString("hex");
    room.players.push({
      name,
      tokenHash: hashToken(token),
      lastSeenAt: Date.now(),
      accountId: account ? account.id : null,
    });
    room.version += 1;
    room.lastMessage = `${name} joined the room.`;
    await saveRoom(code, room);
    return { ...snapshot(room, 1), token };
  });
}

export async function handleState({ request, now = Date.now() }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const code = codeFrom(request);
    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request);
      const player = room.players[seat];
      const account = !player.accountId && room.status !== "playing"
        ? await getAuthenticatedAccount(request)
        : null;
      const accountLinked = bindAccount(room, seat, account);
      if (accountLinked || !Number.isFinite(player.lastSeenAt) || now - player.lastSeenAt >= PRESENCE_WRITE_INTERVAL_MS) {
        player.lastSeenAt = now;
        await saveRoom(code, room);
      }
      return snapshot(room, seat, now);
    });
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.room_state.requests", 1, { outcome });
    metric("bakasha.room_state.duration_ms", performance.now() - startedAt);
  }
}

export async function handleStart({ request }) {
  const code = codeFrom(request);
  return withRoomLock(code, async () => {
    const room = await mustLoad(code);
    const seat = mustBePlayer(room, request);
    if (seat !== 0) throw new HttpError(403, "Only the room creator can start the game.");
    if (room.status === "finished") throw new HttpError(409, "Both players must agree to a rematch.");
    if (!room.players[seat].accountId && room.status !== "playing") {
      bindAccount(room, seat, await getAuthenticatedAccount(request));
    }
    if (room.players.length < 2) throw new HttpError(409, "Wait for your friend to join first.");
    if (room.status === "playing") return snapshot(room, seat); // double-click safe
    const now = Date.now();
    room.game = newGame(room.players.map((player) => player.name), now);
    room.gameId = randomUUID();
    room.chatMessages = [];
    room.rematchRequests = [false, false];
    room.status = "playing";
    room.version += 1;
    room.lastActionId = null;
    room.lastMessage = "The cards are dealt. Good luck!";
    await saveRoom(code, room);
    return snapshot(room, seat, now);
  });
}

export async function handleRematch({ request }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const code = codeFrom(request);
    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request);
      if (room.status !== "finished" || !room.game || !room.game.finished) {
        throw new HttpError(409, "A rematch can only be requested after the game ends.");
      }

      const requests = Array.isArray(room.rematchRequests) ? room.rematchRequests : [false, false];
      if (requests[seat]) return snapshot(room, seat);
      requests[seat] = true;
      room.rematchRequests = requests;
      room.version += 1;

      if (requests[0] && requests[1]) {
        const now = Date.now();
        room.game = newGame(room.players.map((player) => player.name), now);
        room.gameId = randomUUID();
        room.chatMessages = [];
        room.rematchRequests = [false, false];
        room.status = "playing";
        room.lastActionId = null;
        room.lastMessage = "Both players agreed to a rematch. The cards are dealt!";
        await saveRoom(code, room);
        return snapshot(room, seat, now);
      }

      room.lastMessage = `${room.players[seat].name} wants a rematch.`;
      await saveRoom(code, room);
      return snapshot(room, seat);
    });
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.rematch.requests", 1, { outcome });
    metric("bakasha.rematch.duration_ms", performance.now() - startedAt);
  }
}

export async function handleAction({ request, body }) {
  const code = codeFrom(request);
  const actionId = typeof body.actionId === "string" ? body.actionId.slice(0, 64) : "";
  if (!actionId) throw new HttpError(400, "Missing action id.");
  return withRoomLock(code, async () => {
    const room = await mustLoad(code);
    const seat = mustBePlayer(room, request);
    if (room.lastActionId === actionId) return snapshot(room, seat); // retried request
    if (room.status !== "playing" || !room.game) {
      if (body.type === "timeout") return { ...snapshot(room, seat), ignored: true };
      throw new HttpError(409, "The game is not in progress.");
    }
    const now = Date.now();
    const result = applyAction(room.game, seat, body, now);
    if (result.error) throw new HttpError(400, result.error);
    if (result.ignored) return { ...snapshot(room, seat, now), ignored: true };
    room.version += 1;
    room.lastActionId = actionId;
    room.lastMessage = result.message;
    if (room.game.finished) {
      room.status = "finished";
      room.chatMessages = [];
      const [firstPlayer, secondPlayer] = room.players;
      const winner = room.players[seat];
      if (
        room.gameId
        && firstPlayer.accountId
        && secondPlayer.accountId
        && firstPlayer.accountId !== secondPlayer.accountId
        && winner
      ) {
        await recordRankedMatch({
          gameId: room.gameId,
          finishedAt: now,
          winnerId: winner.accountId,
          players: room.players.map((player) => ({
            id: player.accountId,
            username: player.name,
          })),
        });
      }
    }
    await saveRoom(code, room);
    return snapshot(room, seat, now);
  });
}

export async function handleChat({ request, body }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const code = codeFrom(request);
    const text = typeof body.message === "string"
      ? body.message.replace(/[\u0000-\u001f\u007f]/g, "").trim()
      : "";
    if (!text) throw new HttpError(400, "Write a message before sending.");
    if (text.length > 280) throw new HttpError(400, "Messages can be up to 280 characters.");

    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request);
      if (room.status !== "playing" || !room.game || room.game.finished) {
        throw new HttpError(409, "Chat is only available while the game is in progress.");
      }

      const message = {
        id: randomUUID(),
        seat,
        name: room.players[seat].name,
        text,
        sentAt: Date.now(),
      };
      room.chatMessages = Array.isArray(room.chatMessages) ? room.chatMessages : [];
      room.chatMessages.push(message);
      if (room.chatMessages.length > 100) room.chatMessages.shift();
      room.version += 1;
      await saveRoom(code, room);
      return snapshot(room, seat, message.sentAt);
    });
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.room_chat.requests", 1, { outcome });
    metric("bakasha.room_chat.duration_ms", performance.now() - startedAt);
  }
}
