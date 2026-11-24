import { createHash, randomBytes, randomInt } from "node:crypto";
import { HttpError } from "./http.js";
import { applyAction, newGame, publicGame } from "./engine.js";
import { createRoomRecord, loadRoom, saveRoom, withRoomLock } from "./store.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/;

const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

function newCode() {
  let code = "";
  for (let i = 0; i < 10; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
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
      })),
      version: room.version,
      lastMessage: room.lastMessage,
      serverNow: now,
      game: game ? publicGame(game) : null,
    },
    ownHand: game && seat >= 0 ? game.hands[seat] : [],
  };
}

export async function handleCreate({ body }) {
  const name = cleanName(body.name);
  const token = randomBytes(24).toString("hex");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const room = {
      code,
      status: "waiting",
      players: [{ name, tokenHash: hashToken(token) }],
      game: null,
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
    if (existing >= 0) return snapshot(room, existing); // reconnecting
    if (room.players.length >= 2) throw new HttpError(403, "This room already has two players.");
    const name = cleanName(body.name);
    const token = randomBytes(24).toString("hex");
    room.players.push({ name, tokenHash: hashToken(token) });
    room.version += 1;
    room.lastMessage = `${name} joined the room.`;
    await saveRoom(code, room);
    return { ...snapshot(room, 1), token };
  });
}

export async function handleState({ request }) {
  const code = codeFrom(request);
  const room = await mustLoad(code);
  const seat = mustBePlayer(room, request);
  return snapshot(room, seat);
}

export async function handleStart({ request }) {
  const code = codeFrom(request);
  return withRoomLock(code, async () => {
    const room = await mustLoad(code);
    const seat = mustBePlayer(room, request);
    if (seat !== 0) throw new HttpError(403, "Only the room creator can start the game.");
    if (room.players.length < 2) throw new HttpError(409, "Wait for your friend to join first.");
    if (room.status === "playing") return snapshot(room, seat); // double-click safe
    const now = Date.now();
    room.game = newGame(room.players.map((player) => player.name), now);
    room.status = "playing";
    room.version += 1;
    room.lastActionId = null;
    room.lastMessage = "The cards are dealt. Good luck!";
    await saveRoom(code, room);
    return snapshot(room, seat, now);
  });
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
    if (room.game.finished) room.status = "finished";
    await saveRoom(code, room);
    return snapshot(room, seat, now);
  });
}
