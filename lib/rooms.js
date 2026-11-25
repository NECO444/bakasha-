import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";
import { getAuthenticatedAccount } from "./accounts.js";
import { recordRankedMatch } from "./leaderboard.js";
import { applyAction, newGame, publicGame } from "./engine.js";
import {
  createRoomRecord,
  loadPublicRoomCodes,
  loadRoom,
  savePublicRoomCodes,
  saveRoom,
  withRoomLock,
} from "./store.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const MAX_ROOM_MEMBERS = 6;
const PRESENCE_ONLINE_WINDOW_MS = 30_000;
const PRESENCE_WRITE_INTERVAL_MS = 10_000;

const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

function newCode() {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
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
  const activeSeat = room.players.findIndex((player) => player.tokenHash === hash);
  if (activeSeat >= 0) return activeSeat;
  const waitingIndex = (room.nextMatchPlayers || []).findIndex((player) => player.tokenHash === hash);
  return waitingIndex >= 0 ? -waitingIndex - 2 : -1;
}

function playerAtSeat(room, seat) {
  if (seat >= 0) return room.players[seat];
  if (seat <= -2) return (room.nextMatchPlayers || [])[-seat - 2];
  return null;
}

async function requireAccount(request) {
  const account = await getAuthenticatedAccount(request);
  if (!account) throw new HttpError(401, "Sign in to play.");
  return account;
}

async function mustLoad(code) {
  const room = await loadRoom(code);
  if (!room) throw new HttpError(404, "That room was not found or has expired.");
  return room;
}

function mustBeMember(room, request, account) {
  const seat = seatOf(room, bearer(request));
  const player = playerAtSeat(room, seat);
  if (!player) throw new HttpError(403, "You are not a player in this room.");
  if (player.accountId !== account.id) {
    throw new HttpError(403, "This room seat belongs to a different account.");
  }
  return seat;
}

function mustBePlayer(room, request, account) {
  const seat = mustBeMember(room, request, account);
  if (seat < 0) throw new HttpError(409, "You are waiting for the next match.");
  return seat;
}

async function updatePublicRoomIndex(code, add) {
  return withRoomLock("public-room-index", async () => {
    const codes = await loadPublicRoomCodes();
    const nextCodes = add
      ? [...new Set([...codes, code])]
      : codes.filter((listedCode) => listedCode !== code);
    await savePublicRoomCodes(nextCodes);
  });
}

// Public table state plus only this player's own hand.
export function snapshot(room, seat, now = Date.now()) {
  const game = room.game;
  const queuedIndex = seat <= -2 ? -seat - 2 : -1;
  const isQueued = queuedIndex >= 0;
  const queuedPlayer = isQueued ? room.nextMatchPlayers?.[queuedIndex] : null;
  return {
    roomCode: room.code,
    seat,
    publicData: {
      status: isQueued ? "waiting" : room.status,
      roomStatus: room.status,
      queuedForNextMatch: isQueued,
      queuedName: queuedPlayer?.name || null,
      isPublic: room.isPublic === true,
      maxPlayers: room.maxPlayers || 2,
      players: room.players.map((player, index) => ({
        name: player.name,
        handCount: game ? game.hands[index].length : 0,
        online: Number.isFinite(player.lastSeenAt) && now - player.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS,
      })),
      nextMatchPlayers: (room.nextMatchPlayers || []).map((player) => ({
        name: player.name,
        online: Number.isFinite(player.lastSeenAt) && now - player.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS,
      })),
      version: room.version,
      lastMessage: room.lastMessage,
      serverNow: now,
      game: game && !isQueued && room.status !== "closed" ? publicGame(game) : null,
      rematchRequests: room.status === "finished" && Array.isArray(room.rematchRequests)
        ? room.rematchRequests
        : Array(room.players.length).fill(false),
      chatMessages: room.status === "playing" && Array.isArray(room.chatMessages)
        ? room.chatMessages
        : [],
    },
    ownHand: game && seat >= 0 && room.status !== "closed" ? game.hands[seat] : [],
    queuedName: queuedPlayer?.name || null,
  };
}

export async function handleCreate({ request, body }) {
  const account = await requireAccount(request);
  const maxPlayers = body.maxPlayers === undefined ? 2 : Number(body.maxPlayers);
  if (![2, 3, 4, 5, 6].includes(maxPlayers)) {
    throw new HttpError(400, "Choose a room size between two and six players.");
  }
  const token = randomBytes(24).toString("hex");
  const now = Date.now();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = newCode();
    const room = {
      code,
      status: "waiting",
      isPublic: body.isPublic === true,
      maxPlayers,
      nextMatchPlayers: [],
      createdAt: now,
      players: [{
        name: account.username,
        tokenHash: hashToken(token),
        lastSeenAt: now,
        accountId: account.id,
      }],
      game: null,
      gameId: null,
      chatMessages: [],
      rematchRequests: Array(maxPlayers).fill(false),
      version: 1,
      lastActionId: null,
      lastMessage: null,
    };
    if (await createRoomRecord(code, room)) {
      if (room.isPublic) await updatePublicRoomIndex(code, true);
      metric("bakasha.public_rooms.created", 1, { visibility: room.isPublic ? "public" : "private" });
      return { ...snapshot(room, 0), token };
    }
  }
  throw new HttpError(503, "Could not create a room. Please try again.");
}

export async function handleListPublicRooms({ now = Date.now() } = {}) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const rooms = await withRoomLock("public-room-index", async () => {
      const codes = await loadPublicRoomCodes();
      const loaded = await Promise.all(codes.map(async (code) => ({
        code,
        room: CODE_RE.test(code) ? await loadRoom(code) : null,
      })));
      const listed = loaded.filter(({ room }) => (
        room
        && room.isPublic === true
        && room.status === "waiting"
        && room.players.length < (room.maxPlayers || 2)
      ));
      const available = listed.filter(({ room }) => (
        Number.isFinite(room.players[0].lastSeenAt)
        && now - room.players[0].lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS
      ));
      const retainedCodes = listed.map(({ code }) => code);
      if (retainedCodes.length !== codes.length || retainedCodes.some((code, index) => code !== codes[index])) {
        await savePublicRoomCodes(retainedCodes);
      }
      return available.map(({ room }) => ({
        roomCode: room.code,
        hostName: room.players[0].name,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers || 2,
        createdAt: room.createdAt || now,
      }));
    });
    outcome = "success";
    return { rooms: rooms.sort((left, right) => right.createdAt - left.createdAt) };
  } finally {
    metric("bakasha.public_rooms.list.requests", 1, { outcome });
    metric("bakasha.public_rooms.list.duration_ms", performance.now() - startedAt);
  }
}

export async function handleJoin({ request, body }) {
  const account = await requireAccount(request);
  const code = codeFrom(request);
  return withRoomLock(code, async () => {
    const room = await mustLoad(code);
    if (room.status === "closed") throw new HttpError(410, "The room creator ended this room.");
    const existing = seatOf(room, typeof body.token === "string" ? body.token : null);
    if (existing >= 0) {
      const player = playerAtSeat(room, existing);
      if (player.accountId !== account.id) {
        throw new HttpError(403, "This room seat belongs to a different account.");
      }
      player.lastSeenAt = Date.now();
      await saveRoom(code, room);
      return snapshot(room, existing); // reconnecting
    }
    if (existing <= -2) {
      const player = playerAtSeat(room, existing);
      if (player.accountId !== account.id) {
        throw new HttpError(403, "This room seat belongs to a different account.");
      }
      player.lastSeenAt = Date.now();
      await saveRoom(code, room);
      return snapshot(room, existing);
    }
    if (body.publicJoin === true) {
      if (!room.isPublic || room.status !== "waiting" || room.players.length >= (room.maxPlayers || 2)) {
        throw new HttpError(404, "That public game is no longer available.");
      }
    }
    const maxPlayers = room.maxPlayers || 2;
    if (room.isPublic && (room.status !== "waiting" || room.players.length >= maxPlayers)) {
      throw new HttpError(404, "That public game is no longer available.");
    }
    const nextMatchPlayers = room.nextMatchPlayers || [];
    if ([...room.players, ...nextMatchPlayers].some((player) => player.accountId === account.id)) {
      throw new HttpError(409, "You already have a seat in this room.");
    }
    if (room.players.length + nextMatchPlayers.length >= MAX_ROOM_MEMBERS) {
      throw new HttpError(403, `This room has reached its ${MAX_ROOM_MEMBERS}-player limit.`);
    }
    const name = account.username;
    const token = randomBytes(24).toString("hex");
    const player = {
      name,
      tokenHash: hashToken(token),
      lastSeenAt: Date.now(),
      accountId: account.id,
    };
    const queueForNextMatch = room.status !== "waiting" || room.players.length >= maxPlayers;
    const seat = queueForNextMatch ? -nextMatchPlayers.length - 2 : room.players.length;
    if (queueForNextMatch) {
      room.nextMatchPlayers = [...nextMatchPlayers, player];
    } else {
      room.players.push(player);
    }
    room.version += 1;
    room.lastMessage = queueForNextMatch
      ? `${name} joined and is waiting for the next match.`
      : `${name} joined the room.`;
    await saveRoom(code, room);
    if (room.isPublic && room.players.length >= maxPlayers) await updatePublicRoomIndex(code, false);
    if (body.publicJoin === true) metric("bakasha.public_rooms.joined", 1);
    if (queueForNextMatch) metric("bakasha.private_rooms.queued", 1);
    return { ...snapshot(room, seat), token };
  });
}

export async function handleState({ request, now = Date.now() }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBeMember(room, request, account);
      const player = playerAtSeat(room, seat);
      if (!Number.isFinite(player.lastSeenAt) || now - player.lastSeenAt >= PRESENCE_WRITE_INTERVAL_MS) {
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

export async function handleEnd({ request }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request, account);
      if (seat !== 0) throw new HttpError(403, "Only the room creator can end this room.");
      if (room.status === "closed") return { closed: true };
      room.status = "closed";
      room.closedAt = Date.now();
      room.chatMessages = [];
      room.version += 1;
      room.lastMessage = "The room creator ended this room.";
      await saveRoom(code, room);
      if (room.isPublic) await updatePublicRoomIndex(code, false);
      return { closed: true };
    });
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.rooms.ended", 1, { outcome });
    metric("bakasha.rooms.end.duration_ms", performance.now() - startedAt);
  }
}

export async function handleStart({ request }) {
  const account = await requireAccount(request);
  const code = codeFrom(request);
  return withRoomLock(code, async () => {
    const room = await mustLoad(code);
    const seat = mustBePlayer(room, request, account);
    if (seat !== 0) throw new HttpError(403, "Only the room creator can start the game.");
    if (room.status === "closed") throw new HttpError(410, "The room creator ended this room.");
    if (room.status === "finished") {
      const waiting = room.nextMatchPlayers || [];
      if (waiting.length === 0) throw new HttpError(409, "Everyone must agree to a rematch.");
      room.players.push(...waiting);
      room.nextMatchPlayers = [];
      room.maxPlayers = room.players.length;
      const now = Date.now();
      room.game = newGame(room.players.map((player) => player.name), now);
      room.gameId = randomUUID();
      room.chatMessages = [];
      room.rematchRequests = Array(room.players.length).fill(false);
      room.status = "playing";
      room.version += 1;
      room.lastActionId = null;
      room.lastMessage = "The host started a new match with everyone waiting.";
      await saveRoom(code, room);
      return snapshot(room, seat, now);
    }
    const maxPlayers = room.maxPlayers || 2;
    if (room.players.length < maxPlayers) {
      throw new HttpError(409, `Waiting for ${maxPlayers - room.players.length} more player${maxPlayers - room.players.length === 1 ? "" : "s"}.`);
    }
    if (room.status === "playing") return snapshot(room, seat); // double-click safe
    const now = Date.now();
    room.game = newGame(room.players.map((player) => player.name), now);
    room.gameId = randomUUID();
    room.chatMessages = [];
    room.rematchRequests = Array(maxPlayers).fill(false);
    room.status = "playing";
    room.version += 1;
    room.lastActionId = null;
    room.lastMessage = "The cards are dealt. Good luck!";
    await saveRoom(code, room);
    if (room.isPublic) await updatePublicRoomIndex(code, false);
    return snapshot(room, seat, now);
  });
}

export async function handleRematch({ request }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request, account);
      if (room.status !== "finished" || !room.game || !room.game.finished) {
        throw new HttpError(409, "A rematch can only be requested after the game ends.");
      }

      const requests = room.players.map((_, index) => room.rematchRequests?.[index] === true);
      if (requests[seat]) return snapshot(room, seat);
      requests[seat] = true;
      room.rematchRequests = requests;
      room.version += 1;

      if (requests.every(Boolean)) {
        const now = Date.now();
        room.players.push(...(room.nextMatchPlayers || []));
        room.nextMatchPlayers = [];
        room.maxPlayers = room.players.length;
        room.game = newGame(room.players.map((player) => player.name), now);
        room.gameId = randomUUID();
        room.chatMessages = [];
        room.rematchRequests = Array(room.players.length).fill(false);
        room.status = "playing";
        room.lastActionId = null;
        room.lastMessage = "Everyone agreed to a rematch. The cards are dealt!";
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
  const startedAt = performance.now();
  const actionType = ["play", "draw", "timeout", "knock"].includes(body.type) ? body.type : "other";
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const actionId = typeof body.actionId === "string" ? body.actionId.slice(0, 64) : "";
    if (!actionId) throw new HttpError(400, "Missing action id.");
    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request, account);
      if (room.lastActionId === actionId) return snapshot(room, seat); // retried request
      if (room.status !== "playing" || !room.game) {
        if (body.type === "timeout") return { ...snapshot(room, seat), ignored: true };
        throw new HttpError(409, "The game is not in progress.");
      }
      const now = Date.now();
      const action = applyAction(room.game, seat, body, now);
      if (action.error) throw new HttpError(400, action.error);
      if (action.ignored) return { ...snapshot(room, seat, now), ignored: true };
      room.version += 1;
      room.lastActionId = actionId;
      room.lastMessage = action.message;
      if (room.game.finished) {
        room.status = "finished";
        room.chatMessages = [];
        const winner = room.players.find((player) => player.name === room.game.winner);
        if (
          room.gameId
          && winner?.accountId
          && room.players.every((player) => player.accountId)
          && new Set(room.players.map((player) => player.accountId)).size === room.players.length
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
    outcome = result.ignored ? "ignored" : "success";
    return result;
  } finally {
    metric("bakasha.game_action", 1, { action: actionType, outcome });
    metric("bakasha.game_action.duration_ms", performance.now() - startedAt, { action: actionType, outcome });
  }
}

export async function handleChat({ request, body }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const text = typeof body.message === "string"
      ? body.message.replace(/[\u0000-\u001f\u007f]/g, "").trim()
      : "";
    if (!text) throw new HttpError(400, "Write a message before sending.");
    if (text.length > 280) throw new HttpError(400, "Messages can be up to 280 characters.");

    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request, account);
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
