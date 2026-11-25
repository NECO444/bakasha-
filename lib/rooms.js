import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { metric } from "@vercel/functions";
import { HttpError } from "./http.js";
import { getAuthenticatedAccount } from "./accounts.js";
import { recordRankedMatch } from "./leaderboard.js";
import { applyAction, newGame, publicGame } from "./engine.js";
import {
  createRoomRecord,
  clearActiveRoomCode,
  loadActiveRoomCodes,
  loadPublicRoomCodes,
  loadRoom,
  saveActiveRoomCodes,
  saveActiveRoomCode,
  savePublicRoomCodes,
  saveRoom,
  consumeReactionRateLimit,
  withRoomLock,
} from "./store.js";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const MAX_ROOM_MEMBERS = 6;
const MAX_ACTIVE_ROOMS = 2;
const QUICK_REACTIONS = new Set(["👏", "😂", "🔥", "😮", "GG"]);
const PRESENCE_ONLINE_WINDOW_MS = 30_000;
const PRESENCE_WRITE_INTERVAL_MS = 10_000;
const PUBLIC_CHALLENGE_TTL_MS = 60 * 60 * 1000;

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
  if (!CODE_RE.test(code)) throw new HttpError(400, "That game code is not valid.");
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
  if (!room) throw new HttpError(404, "That game was not found or has expired.");
  return room;
}

function activeRoomMembership(room, accountId, now = Date.now()) {
  if (!room || room.status === "closed") return null;
  const seat = room.players.findIndex((player) => player.accountId === accountId);
  const queuedIndex = (room.nextMatchPlayers || [])
    .findIndex((player) => player.accountId === accountId);
  const challengeExpired = room.isPublic === true
    && room.status === "waiting"
    && Number.isFinite(room.publicChallengeExpiresAt)
    && room.publicChallengeExpiresAt <= now;
  const activeSeat = seat >= 0
    && (
      ["waiting", "playing"].includes(room.status)
      || (room.status === "finished" && room.rematchRequests?.[seat] === true)
    );
  const activeQueue = queuedIndex >= 0 && !challengeExpired;
  return challengeExpired || (!activeSeat && !activeQueue)
    ? null
    : { seat, queuedIndex };
}

async function ensureActiveRoomCapacity(
  account,
  requestedCode = null,
  action = "join",
  allowExistingRoom = false,
) {
  const indexedCodes = await loadActiveRoomCodes(account.id);
  const activeCodes = [];
  for (const code of indexedCodes) {
    if (!CODE_RE.test(code)) continue;
    if (activeRoomMembership(await loadRoom(code), account.id)) activeCodes.push(code);
  }

  if (requestedCode && !activeCodes.includes(requestedCode)) {
    const requestedRoom = await loadRoom(requestedCode);
    if (activeRoomMembership(requestedRoom, account.id)) activeCodes.push(requestedCode);
  }
  if (
    activeCodes.length !== indexedCodes.length
    || activeCodes.some((code, index) => code !== indexedCodes[index])
  ) {
    await saveActiveRoomCodes(account.id, activeCodes);
  }
  if (requestedCode && (activeCodes.includes(requestedCode) || allowExistingRoom)) return;
  if (activeCodes.length >= MAX_ACTIVE_ROOMS) {
    metric("bakasha.active_room_limit.rejections", 1, { action });
    throw new HttpError(
      409,
      `You already have the maximum of ${MAX_ACTIVE_ROOMS} active games. End or leave one before joining another.`,
    );
  }
}

function mustBeMember(room, request, account) {
  const seat = seatOf(room, bearer(request));
  const player = playerAtSeat(room, seat);
  if (!player) throw new HttpError(403, "You are not a player in this game.");
  if (player.accountId !== account.id) {
    throw new HttpError(403, "This game seat belongs to a different account.");
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

function startMatch(room, now, message) {
  room.game = newGame(room.players.map((player) => player.name), now);
  room.gameId = randomUUID();
  room.chatMessages = [];
  room.rematchRequests = Array(room.players.length).fill(false);
  room.status = "playing";
  room.version += 1;
  room.lastActionId = null;
  room.lastMessage = message;
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
      publicChallengeExpiresAt: room.publicChallengeExpiresAt || null,
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
  const startedAt = performance.now();
  const visibility = body.isPublic === true ? "public" : "private";
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const maxPlayers = body.maxPlayers === undefined ? 2 : Number(body.maxPlayers);
    if (![2, 3, 4, 5, 6].includes(maxPlayers)) {
      throw new HttpError(400, "Choose a game size between two and six players.");
    }
    const result = await withRoomLock(`account-active-room:${account.id}`, async () => {
      await ensureActiveRoomCapacity(account, null, "create");
      const token = randomBytes(24).toString("hex");
      const now = Date.now();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const code = newCode();
        const room = {
          code,
          status: "waiting",
          isPublic: body.isPublic === true,
          publicChallengeExpiresAt: body.isPublic === true ? now + PUBLIC_CHALLENGE_TTL_MS : null,
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
          await saveActiveRoomCode(account.id, code);
          if (room.isPublic) await updatePublicRoomIndex(code, true);
          metric("bakasha.public_rooms.created", 1, { visibility });
          return { ...snapshot(room, 0), token };
        }
      }
      throw new HttpError(503, "Could not create a game. Please try again.");
    });
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.room_creations.requests", 1, { outcome, visibility });
    metric("bakasha.room_creations.duration_ms", performance.now() - startedAt, { visibility });
  }
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
        && (!Number.isFinite(room.publicChallengeExpiresAt) || room.publicChallengeExpiresAt > now)
      ));
      const available = listed.filter(({ room }) => (
        Number.isFinite(room.publicChallengeExpiresAt)
        || (
          Number.isFinite(room.players[0].lastSeenAt)
          && now - room.players[0].lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS
        )
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

export async function handleListActiveRooms({ request }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const rooms = await withRoomLock(`account-active-room:${account.id}`, async () => {
      const activeCodes = await loadActiveRoomCodes(account.id);
      const validCodes = [];
      const activeRooms = [];
      for (const code of activeCodes) {
        if (!CODE_RE.test(code)) continue;
        const room = await loadRoom(code);
        const membership = activeRoomMembership(room, account.id);
        if (!membership) continue;
        validCodes.push(code);
        const isHost = membership.seat === 0;
        activeRooms.push({
          roomCode: room.code,
          hostName: room.players[0]?.name || "Game host",
          playerCount: room.players.length,
          maxPlayers: room.maxPlayers || 2,
          status: room.status,
          isPublic: room.isPublic === true,
          publicChallengeExpiresAt: room.publicChallengeExpiresAt || null,
          createdAt: room.createdAt || Date.now(),
          isHost,
          queuedForNextMatch: membership.seat < 0,
          canLeave: !isHost && (membership.seat < 0 || room.status === "waiting"),
          canEnd: isHost,
        });
      }
      await saveActiveRoomCodes(account.id, validCodes);
      return activeRooms;
    });
    outcome = "success";
    return { rooms: rooms.sort((left, right) => right.createdAt - left.createdAt) };
  } finally {
    metric("bakasha.active_rooms.list.requests", 1, { outcome });
    metric("bakasha.active_rooms.list.duration_ms", performance.now() - startedAt);
  }
}

export async function handleActiveRoomAction({ request, body }) {
  const startedAt = performance.now();
  const action = body.action === "end" ? "end" : body.action === "leave" ? "leave" : "other";
  let outcome = "error";
  try {
    if (action === "other") throw new HttpError(400, "Choose whether to end or leave the active game.");
    const account = await requireAccount(request);
    const result = await withRoomLock(`account-active-room:${account.id}`, async () => {
      const activeCodes = await loadActiveRoomCodes(account.id);
      const requestedCode = typeof body.roomCode === "string" ? body.roomCode.toUpperCase() : null;
      const code = requestedCode || (activeCodes.length === 1 ? activeCodes[0] : null);
      if (!code) {
        throw new HttpError(400, "Choose which active game to end or leave.");
      }
      if (!CODE_RE.test(code) || !activeCodes.includes(code)) {
        throw new HttpError(404, "That game is not in your active games.");
      }
      return withRoomLock(code, async () => {
        const room = await loadRoom(code);
        if (!room || room.status === "closed") {
          await clearActiveRoomCode(account.id, code);
          throw new HttpError(404, "That game has already ended.");
        }
        const seat = room.players.findIndex((player) => player.accountId === account.id);
        const queuedIndex = (room.nextMatchPlayers || [])
          .findIndex((player) => player.accountId === account.id);
        if (seat < 0 && queuedIndex < 0) {
          await clearActiveRoomCode(account.id, code);
          throw new HttpError(403, "You are not a player in this game.");
        }

        if (action === "end") {
          if (seat !== 0) throw new HttpError(403, "Only the game host can end this game.");
          room.status = "closed";
          room.closedAt = Date.now();
          room.chatMessages = [];
          room.version += 1;
          room.lastMessage = "The game host ended this game.";
          await saveRoom(code, room);
          if (room.isPublic) await updatePublicRoomIndex(code, false);
          await clearActiveRoomCode(account.id, code);
          return { ended: true, roomCode: code };
        }

        if (seat === 0) throw new HttpError(403, "The host must end the game instead of leaving.");
        if (queuedIndex >= 0) {
          room.nextMatchPlayers.splice(queuedIndex, 1);
        } else if (room.status === "waiting") {
          room.players.splice(seat, 1);
        } else {
          throw new HttpError(409, "You can leave after the current match ends.");
        }
        room.version += 1;
        room.lastMessage = `${account.username} left the game.`;
        await saveRoom(code, room);
        await clearActiveRoomCode(account.id, code);
        if (room.isPublic && room.status === "waiting" && room.players.length < (room.maxPlayers || 2)) {
          await updatePublicRoomIndex(code, true);
        }
        return { left: true, roomCode: code };
      });
    });
    outcome = "success";
    return result;
  } finally {
    metric("bakasha.active_rooms.actions", 1, { action, outcome });
    metric("bakasha.active_rooms.actions.duration_ms", performance.now() - startedAt, { action, outcome });
  }
}

export async function handleJoin({ request, body }) {
  const startedAt = performance.now();
  let outcome = "error";
  let autoStarted = false;
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const result = await withRoomLock(`account-active-room:${account.id}`, async () => {
      return withRoomLock(code, async () => {
        const room = await mustLoad(code);
        if (room.status === "closed") throw new HttpError(410, "The game host ended this game.");
        const tokenSeat = seatOf(room, typeof body.token === "string" ? body.token : null);
        let existing = tokenSeat;
        if (existing === -1) {
          const accountSeat = room.players.findIndex((player) => player.accountId === account.id);
          const queuedIndex = (room.nextMatchPlayers || [])
            .findIndex((player) => player.accountId === account.id);
          existing = accountSeat >= 0 ? accountSeat : queuedIndex >= 0 ? -queuedIndex - 2 : -1;
        }
        if (existing >= 0) {
          const player = playerAtSeat(room, existing);
          if (player.accountId !== account.id) {
            throw new HttpError(403, "This game seat belongs to a different account.");
          }
          await ensureActiveRoomCapacity(account, code, "join", true);
          const token = tokenSeat === existing && typeof body.token === "string"
            ? body.token
            : randomBytes(24).toString("hex");
          if (tokenSeat !== existing) player.tokenHash = hashToken(token);
          player.lastSeenAt = Date.now();
          await saveRoom(code, room);
          if (activeRoomMembership(room, account.id)) await saveActiveRoomCode(account.id, code);
          return { ...snapshot(room, existing), token };
        }
        if (existing <= -2) {
          const player = playerAtSeat(room, existing);
          if (player.accountId !== account.id) {
            throw new HttpError(403, "This game seat belongs to a different account.");
          }
          await ensureActiveRoomCapacity(account, code, "join", true);
          const token = tokenSeat === existing && typeof body.token === "string"
            ? body.token
            : randomBytes(24).toString("hex");
          if (tokenSeat !== existing) player.tokenHash = hashToken(token);
          player.lastSeenAt = Date.now();
          await saveRoom(code, room);
          if (activeRoomMembership(room, account.id)) await saveActiveRoomCode(account.id, code);
          return { ...snapshot(room, existing), token };
        }
        if (
          Number.isFinite(room.publicChallengeExpiresAt)
          && room.status === "waiting"
          && room.publicChallengeExpiresAt <= Date.now()
        ) {
          throw new HttpError(410, "This public challenge has expired.");
        }
        if (body.publicJoin === true && !room.isPublic) {
          throw new HttpError(404, "That game is not available for public play.");
        }
        await ensureActiveRoomCapacity(account, code);
        const maxPlayers = room.maxPlayers || 2;
        const nextMatchPlayers = room.nextMatchPlayers || [];
        if ([...room.players, ...nextMatchPlayers].some((player) => player.accountId === account.id)) {
          throw new HttpError(409, "You already have a seat in this game.");
        }
        if (room.players.length + nextMatchPlayers.length >= MAX_ROOM_MEMBERS) {
          throw new HttpError(403, `This game has reached its ${MAX_ROOM_MEMBERS}-player limit.`);
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
        let gameStartedAt;
        if (queueForNextMatch) {
          room.nextMatchPlayers = [...nextMatchPlayers, player];
        } else {
          room.players.push(player);
        }
        room.version += 1;
        room.lastMessage = queueForNextMatch
          ? `${name} joined and is waiting for the next match.`
          : `${name} joined the game.`;
        if (!queueForNextMatch && maxPlayers === 2 && room.players.length === maxPlayers) {
          gameStartedAt = Date.now();
          startMatch(room, gameStartedAt, "Both players are here. The game starts now!");
          autoStarted = true;
        }
        await saveRoom(code, room);
        await saveActiveRoomCode(account.id, code);
        if (room.isPublic && room.players.length >= maxPlayers) await updatePublicRoomIndex(code, false);
        if (body.publicJoin === true) metric("bakasha.public_rooms.joined", 1);
        if (autoStarted) metric("bakasha.games.auto_started", 1, { players: "2" });
        if (queueForNextMatch) {
          metric("bakasha.games.queued", 1, { visibility: room.isPublic ? "public" : "private" });
        }
        return { ...snapshot(room, seat, gameStartedAt), token };
      });
    });
    outcome = autoStarted
      ? "started"
      : result.publicData.queuedForNextMatch ? "queued" : "joined";
    return result;
  } finally {
    metric("bakasha.game_joins.requests", 1, { outcome });
    metric("bakasha.game_joins.duration_ms", performance.now() - startedAt);
  }
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
      if (seat !== 0) throw new HttpError(403, "Only the game host can end this game.");
      if (room.status === "closed") return { closed: true };
      room.status = "closed";
      room.closedAt = Date.now();
      room.chatMessages = [];
      room.version += 1;
      room.lastMessage = "The game host ended this game.";
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
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const result = await withRoomLock(`account-active-room:${account.id}`, async () => {
      return withRoomLock(code, async () => {
        const room = await mustLoad(code);
        const seat = mustBePlayer(room, request, account);
        if (seat !== 0) throw new HttpError(403, "Only the game host can start the game.");
        if (room.status === "closed") throw new HttpError(410, "The game host ended this game.");
        if (room.status === "finished") {
          const waiting = room.nextMatchPlayers || [];
          if (waiting.length === 0) throw new HttpError(409, "Everyone must agree to a rematch.");
          await ensureActiveRoomCapacity(account, code, "start");
          await saveActiveRoomCode(account.id, code);
          room.players.push(...waiting);
          room.nextMatchPlayers = [];
          room.maxPlayers = room.players.length;
          const now = Date.now();
          startMatch(room, now, "The host started a new match with everyone waiting.");
          await saveRoom(code, room);
          return snapshot(room, seat, now);
        }
        const maxPlayers = room.maxPlayers || 2;
        if (room.players.length < maxPlayers) {
          const remaining = maxPlayers - room.players.length;
          throw new HttpError(409, `Waiting for ${remaining} more player${remaining === 1 ? "" : "s"}.`);
        }
        if (room.status === "playing") return snapshot(room, seat); // double-click safe
        const now = Date.now();
        startMatch(room, now, "The cards are dealt. Good luck!");
        await saveRoom(code, room);
        if (room.isPublic) await updatePublicRoomIndex(code, false);
        return snapshot(room, seat, now);
      });
    });
    outcome = result.publicData.game ? "started" : "success";
    return result;
  } finally {
    metric("bakasha.game_starts.requests", 1, { outcome });
    metric("bakasha.game_starts.duration_ms", performance.now() - startedAt);
  }
}

export async function handleRematch({ request }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    const result = await withRoomLock(`account-active-room:${account.id}`, async () => {
      return withRoomLock(code, async () => {
        const room = await mustLoad(code);
        const seat = mustBePlayer(room, request, account);
        if (room.status !== "finished" || !room.game || !room.game.finished) {
          throw new HttpError(409, "A rematch can only be requested after the game ends.");
        }

        const requests = room.players.map((_, index) => room.rematchRequests?.[index] === true);
        if (requests[seat]) return snapshot(room, seat);
        await ensureActiveRoomCapacity(account, code, "rematch");
        requests[seat] = true;
        room.rematchRequests = requests;
        room.version += 1;
        room.lastMessage = requests.every(Boolean)
          ? "Everyone agreed to a rematch. The cards are dealt!"
          : `${room.players[seat].name} wants a rematch.`;
        await saveActiveRoomCode(account.id, code);

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
          await saveRoom(code, room);
          return snapshot(room, seat, now);
        }

        await saveRoom(code, room);
        return snapshot(room, seat);
      });
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

export async function handleReaction({ request, body }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await requireAccount(request);
    const code = codeFrom(request);
    if (typeof body.reaction !== "string" || !QUICK_REACTIONS.has(body.reaction)) {
      throw new HttpError(400, "Choose one of the available quick reactions.");
    }

    const result = await withRoomLock(code, async () => {
      const room = await mustLoad(code);
      const seat = mustBePlayer(room, request, account);
      if (room.status !== "playing" || !room.game || room.game.finished) {
        throw new HttpError(409, "Reactions are only available while the game is in progress.");
      }
      if (!(await consumeReactionRateLimit(code, seat))) {
        throw new HttpError(429, "Wait a moment before sending another reaction.");
      }
      const message = {
        id: randomUUID(),
        seat,
        name: room.players[seat].name,
        text: body.reaction,
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
    metric("bakasha.room_reactions.requests", 1, { outcome });
    metric("bakasha.room_reactions.duration_ms", performance.now() - startedAt, { outcome });
  }
}
