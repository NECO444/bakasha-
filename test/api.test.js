import test from "node:test";
import assert from "node:assert/strict";
import {
  handleAction,
  handleActiveRoomAction,
  handleCreate,
  handleJoin,
  handleListActiveRooms,
  handleStart,
  handleState,
} from "../lib/rooms.js";
import { HttpError } from "../lib/http.js";
import { handleLeaderboard } from "../lib/leaderboard.js";
import { loadRoom, saveRoom } from "../lib/store.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

const req = (code, path, token, account) => accountRequest(
  `/api/rooms/${code}/${path}`,
  account,
  token ? { authorization: `Bearer ${token}` } : {},
);

test("full room flow: create, join, start, play, privacy, reconnect", async () => {
  const host = await createTestAccount("ann");
  const guest = await createTestAccount("ben");
  const stranger = await createTestAccount("cy");
  const created = await handleCreate({ request: accountRequest("/api/rooms", host), body: { name: "untrusted name" } });
  assert.equal(created.seat, 0);
  assert.match(created.roomCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  const code = created.roomCode;

  await assert.rejects(handleStart({ request: req(code, "start", created.token, host) }), (e) => e instanceof HttpError && e.status === 409);

  const joined = await handleJoin({ request: req(code, "join", null, guest), body: { name: "untrusted name" } });
  assert.equal(joined.seat, 1);
  const queued = await handleJoin({ request: req(code, "join", null, stranger), body: { name: "Cy" } });
  assert.equal(queued.publicData.queuedForNextMatch, true);
  assert.equal(queued.publicData.queuedName, stranger.username);

  const again = await handleJoin({ request: req(code, "join", null, guest), body: { token: joined.token } });
  assert.equal(again.seat, 1);

  await assert.rejects(handleStart({ request: req(code, "start", joined.token, guest) }), (e) => e.status === 403);
  await assert.rejects(handleState({ request: req(code, "state", created.token, stranger) }), (e) => e.status === 403);
  const started = await handleStart({ request: req(code, "start", created.token, host) });
  assert.equal(started.publicData.status, "playing");
  assert.equal(started.ownHand.length, 4);

  const guestView = await handleState({ request: req(code, "state", joined.token, guest) });
  const hostText = JSON.stringify(started.publicData);
  const guestText = JSON.stringify(guestView.publicData);
  for (const card of [...started.ownHand, ...guestView.ownHand]) {
    if (card.id !== started.publicData.game.discard[0].id) {
      assert.ok(!hostText.includes(card.id) && !guestText.includes(card.id), "hands must not leak into public data");
    }
  }
  assert.notDeepEqual(started.ownHand, guestView.ownHand);

  await assert.rejects(handleState({ request: req(code, "state", "nope", guest) }), (e) => e.status === 403);
  await assert.rejects(handleAction({ request: req(code, "action", joined.token, guest), body: { type: "draw", actionId: "a1" } }), (e) => e.status === 400);

  const moved = await handleAction({ request: req(code, "action", created.token, host), body: { type: "draw", actionId: "a2" } });
  assert.equal(moved.ownHand.length >= 4, true);
  const retried = await handleAction({ request: req(code, "action", created.token, host), body: { type: "draw", actionId: "a2" } });
  assert.equal(retried.publicData.version, moved.publicData.version, "retrying the same action id must not apply twice");
});

test("room access requires a signed-in account", async () => {
  await assert.rejects(handleCreate({ request: accountRequest("/api/rooms"), body: { name: "Guest" } }), (e) => e.status === 401);
  await assert.rejects(handleState({ request: req("2345", "state", "token") }), (e) => e.status === 401);
  await assert.rejects(handleState({ request: req("short", "state", "x", await createTestAccount()) }), (e) => e.status === 400);
});

test("an account cannot create or join a second active room, but can reconnect and play again after finishing", async () => {
  const owner = await createTestAccount("active_owner");
  const guest = await createTestAccount("active_guest");
  const otherHost = await createTestAccount("active_host");
  const firstRoom = await handleCreate({
    request: accountRequest("/api/rooms", owner),
    body: {},
  });
  const guestSeat = await handleJoin({
    request: req(firstRoom.roomCode, "join", null, guest),
    body: {},
  });
  const otherRoom = await handleCreate({
    request: accountRequest("/api/rooms", otherHost),
    body: {},
  });

  await assert.rejects(
    handleCreate({ request: accountRequest("/api/rooms", owner), body: {} }),
    (error) => error.status === 409 && error.message.includes(firstRoom.roomCode),
  );
  await assert.rejects(
    handleJoin({ request: req(otherRoom.roomCode, "join", null, guest), body: {} }),
    (error) => error.status === 409 && error.message.includes(firstRoom.roomCode),
  );

  const reconnected = await handleJoin({
    request: req(firstRoom.roomCode, "join", null, guest),
    body: { token: guestSeat.token },
  });
  assert.equal(reconnected.seat, guestSeat.seat);

  const finishedRoom = await loadRoom(firstRoom.roomCode);
  finishedRoom.status = "finished";
  finishedRoom.nextMatchPlayers = [];
  await saveRoom(firstRoom.roomCode, finishedRoom);
  const afterFinish = await handleCreate({
    request: accountRequest("/api/rooms", owner),
    body: {},
  });
  assert.notEqual(afterFinish.roomCode, firstRoom.roomCode);
});

test("simultaneous room creation requests reserve at most one active room per account", async () => {
  const account = await createTestAccount("active_race");
  const results = await Promise.allSettled([
    handleCreate({ request: accountRequest("/api/rooms", account), body: {} }),
    handleCreate({ request: accountRequest("/api/rooms", account), body: {} }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.status, 409);
});

test("simultaneous joins into different rooms reserve at most one room per account", async () => {
  const firstHost = await createTestAccount("join_host1");
  const secondHost = await createTestAccount("join_host2");
  const joiningAccount = await createTestAccount("join_race");
  const firstRoom = await handleCreate({
    request: accountRequest("/api/rooms", firstHost),
    body: {},
  });
  const secondRoom = await handleCreate({
    request: accountRequest("/api/rooms", secondHost),
    body: {},
  });

  const results = await Promise.allSettled([
    handleJoin({ request: req(firstRoom.roomCode, "join", null, joiningAccount), body: {} }),
    handleJoin({ request: req(secondRoom.roomCode, "join", null, joiningAccount), body: {} }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.status, 409);
});

test("active games can be listed, rejoined without a saved token, left before play, or ended by the host", async () => {
  const host = await createTestAccount("active_list_host");
  const guest = await createTestAccount("active_list_guest");
  const room = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { isPublic: true, maxPlayers: 3 },
  });

  assert.deepEqual((await handleListActiveRooms({ request: accountRequest("/api/rooms/active", host) })).rooms.map((active) => ({
    roomCode: active.roomCode,
    isHost: active.isHost,
    canEnd: active.canEnd,
  })), [{ roomCode: room.roomCode, isHost: true, canEnd: true }]);

  const guestSeat = await handleJoin({
    request: req(room.roomCode, "join", null, guest),
    body: { publicJoin: true },
  });
  const guestRooms = await handleListActiveRooms({ request: accountRequest("/api/rooms/active", guest) });
  assert.equal(guestRooms.rooms[0].canLeave, true);

  const rejoined = await handleJoin({
    request: req(room.roomCode, "join", null, guest),
    body: {},
  });
  assert.equal(rejoined.seat, guestSeat.seat);
  assert.equal(typeof rejoined.token, "string");

  await handleActiveRoomAction({
    request: accountRequest("/api/rooms/active", guest),
    body: { action: "leave" },
  });
  assert.deepEqual((await handleListActiveRooms({ request: accountRequest("/api/rooms/active", guest) })).rooms, []);
  assert.equal((await loadRoom(room.roomCode)).players.length, 1);
  const guestNewRoom = await handleCreate({ request: accountRequest("/api/rooms", guest), body: {} });
  assert.ok(guestNewRoom.roomCode);

  await handleActiveRoomAction({
    request: accountRequest("/api/rooms/active", host),
    body: { action: "end" },
  });
  assert.deepEqual((await handleListActiveRooms({ request: accountRequest("/api/rooms/active", host) })).rooms, []);
  assert.equal((await loadRoom(room.roomCode)).status, "closed");
  assert.ok((await handleCreate({ request: accountRequest("/api/rooms", host), body: {} })).roomCode);
});

test("leaving a game after it starts is blocked, but the host can end it", async () => {
  const host = await createTestAccount("active_play_host");
  const guest = await createTestAccount("active_play_guest");
  const room = await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  await handleJoin({ request: req(room.roomCode, "join", null, guest), body: {} });

  await assert.rejects(
    handleActiveRoomAction({
      request: accountRequest("/api/rooms/active", guest),
      body: { action: "leave" },
    }),
    (error) => error.status === 409,
  );
  await handleActiveRoomAction({
    request: accountRequest("/api/rooms/active", host),
    body: { action: "end" },
  });
});

test("online group rooms fill their selected capacity before the host can start", async () => {
  const host = await createTestAccount("group_host");
  const second = await createTestAccount("group_second");
  const third = await createTestAccount("group_third");
  const extra = await createTestAccount("group_extra");
  const created = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { maxPlayers: 3 },
  });
  assert.equal(created.publicData.maxPlayers, 3);
  await assert.rejects(
    handleStart({ request: req(created.roomCode, "start", created.token, host) }),
    (error) => error.status === 409,
  );

  const joinedSecond = await handleJoin({
    request: req(created.roomCode, "join", null, second),
    body: {},
  });
  const joinedThird = await handleJoin({
    request: req(created.roomCode, "join", null, third),
    body: {},
  });
  assert.equal(joinedSecond.seat, 1);
  assert.equal(joinedThird.seat, 2);
  const queuedExtra = await handleJoin({ request: req(created.roomCode, "join", null, extra), body: {} });
  assert.equal(queuedExtra.publicData.queuedForNextMatch, true);
  assert.equal(queuedExtra.seat, -2);

  const started = await handleStart({ request: req(created.roomCode, "start", created.token, host) });
  assert.equal(started.publicData.players.length, 3);
  assert.equal(started.publicData.game.round, 1);
  assert.equal(started.ownHand.length, 4);

  const room = await loadRoom(created.roomCode);
  room.game.hands = [
    [{ id: "hearts-3", suit: "hearts", rank: "3" }],
    [{ id: "clubs-9", suit: "clubs", rank: "9" }],
    [],
  ];
  room.game.discard = [{ id: "hearts-5", suit: "hearts", rank: "5" }];
  room.game.activeSuit = "hearts";
  room.game.current = 0;
  room.game.pending = 0;
  room.game.pendingType = null;
  room.game.combo = null;
  room.game.freeSuitPlay = false;
  room.game.mustDrawSeat = null;
  room.game.roundOut = [false, false, false];
  room.game.eliminated = [false, false, true];
  room.game.knocked = [false, false, false];
  room.game.finished = false;
  room.game.winner = null;
  await saveRoom(created.roomCode, room);

  const hostAction = req(created.roomCode, "action", created.token, host);
  await handleAction({ request: hostAction, body: { type: "knock", actionId: "group-knock" } });
  const finished = await handleAction({
    request: hostAction,
    body: { type: "play", cardId: "hearts-3", actionId: "group-final-play" },
  });
  assert.equal(finished.publicData.status, "finished");
  assert.equal(finished.publicData.game.winner, host.username);
  const standings = await handleLeaderboard();
  assert.equal(standings.players.find((player) => player.username === host.username).wins, 1);
  assert.equal(standings.players.find((player) => player.username === second.username).losses, 1);
  assert.equal(standings.players.find((player) => player.username === third.username).losses, 1);
});

test("room presence becomes away after 30 seconds and reconnect restores the same seat", async () => {
  const host = await createTestAccount("host");
  const guest = await createTestAccount("guest");
  const created = await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  const code = created.roomCode;
  const hostRequest = req(code, "state", created.token, host);
  const joined = await handleJoin({ request: req(code, "join", null, guest), body: {} });
  const joinedAt = Date.now();

  const active = await handleState({ request: hostRequest });
  assert.deepEqual(active.publicData.players.map((player) => player.online), [true, true]);

  const stale = await handleState({ request: hostRequest, now: joinedAt + 30_001 });
  assert.deepEqual(stale.publicData.players.map((player) => player.online), [true, false]);

  const reconnected = await handleJoin({ request: req(code, "join", null, guest), body: { token: joined.token } });
  assert.equal(reconnected.seat, 1);
  assert.deepEqual(reconnected.publicData.players.map((player) => player.online), [true, true]);
});
