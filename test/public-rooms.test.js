import test from "node:test";
import assert from "node:assert/strict";
import { handleCreate, handleEnd, handleJoin, handleListPublicRooms, handleRematch, handleStart, handleState } from "../lib/rooms.js";
import { loadRoom, saveRoom } from "../lib/store.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

const request = (code, account, token, route = "join") => accountRequest(
  `/api/rooms/${code}/${route}`,
  account,
  token ? { authorization: `Bearer ${token}` } : {},
);

test("public lobby lists only active public waiting rooms without room credentials", async () => {
  const privateHost = await createTestAccount("private");
  const publicHost = await createTestAccount("public");
  const guest = await createTestAccount("guest");
  const privateRoom = await handleCreate({ request: accountRequest("/api/rooms", privateHost), body: {} });
  const publicRoom = await handleCreate({ request: accountRequest("/api/rooms", publicHost), body: { isPublic: true } });
  const rooms = await handleListPublicRooms();

  assert.deepEqual(rooms.rooms.map((room) => room.roomCode), [publicRoom.roomCode]);
  assert.equal(rooms.rooms[0].hostName, publicHost.username);
  assert.equal(rooms.rooms[0].playerCount, 1);
  assert.equal(JSON.stringify(rooms).includes(publicRoom.token), false);
  assert.equal(JSON.stringify(rooms).includes(privateRoom.roomCode), false);

  const joined = await handleJoin({
    request: request(publicRoom.roomCode, guest),
    body: { publicJoin: true },
  });
  assert.equal(joined.seat, 1);
  assert.equal((await handleListPublicRooms()).rooms.some((room) => room.roomCode === publicRoom.roomCode), false);
  const reconnected = await handleJoin({
    request: request(publicRoom.roomCode, guest, joined.token),
    body: { publicJoin: true, token: joined.token },
  });
  assert.equal(reconnected.seat, 1);

  await assert.rejects(
    handleJoin({
      request: request(privateRoom.roomCode, guest),
      body: { publicJoin: true },
    }),
    (error) => error.status === 404,
  );
});

test("public lobby hides inactive hosts but allows joining a still-waiting room", async () => {
  const inactiveHost = await createTestAccount("away");
  const activeHost = await createTestAccount("playing");
  const guest = await createTestAccount("guest");
  const activeGuest = await createTestAccount("active_guest");
  const inactiveRoom = await handleCreate({ request: accountRequest("/api/rooms", inactiveHost), body: { isPublic: true } });
  const inactiveData = await loadRoom(inactiveRoom.roomCode);
  inactiveData.players[0].lastSeenAt -= 31_000;
  inactiveData.publicChallengeExpiresAt = null;
  await saveRoom(inactiveRoom.roomCode, inactiveData);
  assert.equal((await handleListPublicRooms()).rooms.some((room) => room.roomCode === inactiveRoom.roomCode), false);
  const joinedInactiveRoom = await handleJoin({
    request: request(inactiveRoom.roomCode, guest),
    body: { publicJoin: true },
  });
  assert.equal(joinedInactiveRoom.seat, 1);

  const activeRoom = await handleCreate({ request: accountRequest("/api/rooms", activeHost), body: { isPublic: true } });
  const joined = await handleJoin({
    request: request(activeRoom.roomCode, activeGuest),
    body: { publicJoin: true },
  });
  await handleStart({
    request: request(activeRoom.roomCode, activeHost, activeRoom.token, "start"),
  });

  const rooms = await handleListPublicRooms();
  assert.equal(rooms.rooms.some((room) => room.roomCode === inactiveRoom.roomCode), false);
  assert.equal(rooms.rooms.some((room) => room.roomCode === activeRoom.roomCode), false);
  assert.equal(joined.seat, 1);
});

test("broadcast challenges stay open while the host is away and expire after one hour", async () => {
  const host = await createTestAccount("broadcast_host");
  const guest = await createTestAccount("broadcast_guest");
  const room = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { isPublic: true, maxPlayers: 3 },
  });
  const storedRoom = await loadRoom(room.roomCode);
  assert.equal(storedRoom.publicChallengeExpiresAt, storedRoom.createdAt + 60 * 60 * 1000);

  storedRoom.players[0].lastSeenAt -= 31_000;
  await saveRoom(room.roomCode, storedRoom);
  assert.ok((await handleListPublicRooms()).rooms.some((listed) => listed.roomCode === room.roomCode));

  const joined = await handleJoin({
    request: request(room.roomCode, guest),
    body: { publicJoin: true },
  });
  assert.equal(joined.publicData.players[1].name, guest.username);
  assert.equal(joined.publicData.status, "waiting");
  const hostState = await handleState({
    request: request(room.roomCode, host, room.token, "state"),
  });
  assert.equal(hostState.publicData.players[1].name, guest.username);

  const expiredHost = await createTestAccount("expired_host");
  const expiredGuest = await createTestAccount("expired_guest");
  const expiredRoom = await handleCreate({
    request: accountRequest("/api/rooms", expiredHost),
    body: { isPublic: true },
  });
  const expiredData = await loadRoom(expiredRoom.roomCode);
  expiredData.publicChallengeExpiresAt = Date.now() - 1;
  await saveRoom(expiredRoom.roomCode, expiredData);

  assert.equal(
    (await handleListPublicRooms()).rooms.some((listed) => listed.roomCode === expiredRoom.roomCode),
    false,
  );
  await assert.rejects(
    handleJoin({
      request: request(expiredRoom.roomCode, expiredGuest),
      body: { publicJoin: true },
    }),
    (error) => error.status === 410,
  );
  const replacementRoom = await handleCreate({
    request: accountRequest("/api/rooms", expiredHost),
    body: {},
  });
  assert.notEqual(replacementRoom.roomCode, expiredRoom.roomCode);
});

test("public group rooms stay listed until their selected seats are filled", async () => {
  const host = await createTestAccount("grouphost");
  const firstGuest = await createTestAccount("groupone");
  const secondGuest = await createTestAccount("grouptwo");
  const room = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { isPublic: true, maxPlayers: 4 },
  });

  assert.deepEqual((await handleListPublicRooms()).rooms[0], {
    roomCode: room.roomCode,
    hostName: host.username,
    playerCount: 1,
    maxPlayers: 4,
    createdAt: (await loadRoom(room.roomCode)).createdAt,
  });

  const firstJoin = await handleJoin({
    request: request(room.roomCode, firstGuest),
    body: { publicJoin: true },
  });
  assert.equal(firstJoin.seat, 1);
  const stillOpen = (await handleListPublicRooms()).rooms[0];
  assert.equal(stillOpen.playerCount, 2);
  assert.equal(stillOpen.maxPlayers, 4);

  const secondJoin = await handleJoin({
    request: request(room.roomCode, secondGuest),
    body: { publicJoin: true },
  });
  assert.equal(secondJoin.seat, 2);
  assert.equal((await handleListPublicRooms()).rooms[0].playerCount, 3);
});

test("a two-player game starts automatically when the invited player joins", async () => {
  const host = await createTestAccount("duelhost");
  const friend = await createTestAccount("duelfriend");
  const game = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { maxPlayers: 2 },
  });

  const joined = await handleJoin({
    request: request(game.roomCode, friend),
    body: {},
  });
  assert.equal(joined.publicData.status, "playing");
  assert.ok(joined.publicData.game);
  assert.equal(joined.publicData.players.length, 2);
  assert.equal(joined.publicData.players[0].handCount, 4);
  assert.equal(joined.publicData.players[1].handCount, 4);

  const hostState = await handleState({
    request: request(game.roomCode, host, game.token, "state"),
  });
  assert.equal(hostState.publicData.status, "playing");
  assert.deepEqual(hostState.publicData.game, joined.publicData.game);

  const hostStartRetry = await handleStart({
    request: request(game.roomCode, host, game.token, "start"),
  });
  assert.deepEqual(hostStartRetry.publicData.game, hostState.publicData.game);
});

test("late public-game joiners queue for the next match instead of getting an unavailable error", async () => {
  const host = await createTestAccount("publichost");
  const firstGuest = await createTestAccount("publicone");
  const lateGuest = await createTestAccount("publiclate");
  const room = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { isPublic: true, maxPlayers: 2 },
  });
  const firstJoin = await handleJoin({
    request: request(room.roomCode, firstGuest),
    body: { publicJoin: true },
  });
  await handleStart({
    request: request(room.roomCode, host, room.token, "start"),
  });

  const lateJoin = await handleJoin({
    request: request(room.roomCode, lateGuest),
    body: { publicJoin: true },
  });
  assert.equal(lateJoin.seat, -2);
  assert.equal(lateJoin.publicData.queuedForNextMatch, true);
  assert.equal(lateJoin.publicData.status, "waiting");
  assert.equal(lateJoin.publicData.game, null);
  assert.equal(lateJoin.publicData.players.length, 2);

  const queuedState = await handleState({
    request: request(room.roomCode, lateGuest, lateJoin.token, "state"),
  });
  assert.equal(queuedState.publicData.queuedName, lateGuest.username);
  assert.equal(firstJoin.seat, 1);
});

test("private rooms queue late joiners for the next match and can be ended by the creator", async () => {
  const host = await createTestAccount("roomhost");
  const guest = await createTestAccount("roomguest");
  const lateGuest = await createTestAccount("latemember");
  const laterGuest = await createTestAccount("latermember");
  const secondLaterGuest = await createTestAccount("secondlater");
  const thirdLaterGuest = await createTestAccount("thirdlater");
  const overLimitGuest = await createTestAccount("overlimit");
  const room = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: { maxPlayers: 2 },
  });
  const joined = await handleJoin({
    request: request(room.roomCode, guest),
    body: {},
  });
  await handleStart({
    request: request(room.roomCode, host, room.token, "start"),
  });

  const queued = await handleJoin({
    request: request(room.roomCode, lateGuest),
    body: {},
  });
  assert.equal(queued.seat, -2);
  assert.equal(queued.publicData.queuedForNextMatch, true);
  assert.equal(queued.publicData.game, null);
  const queuedState = await handleState({
    request: request(room.roomCode, lateGuest, queued.token, "state"),
  });
  assert.equal(queuedState.publicData.queuedName, lateGuest.username);

  const finishedRoom = await loadRoom(room.roomCode);
  finishedRoom.status = "finished";
  finishedRoom.game.finished = true;
  finishedRoom.rematchRequests = [false, false];
  await saveRoom(room.roomCode, finishedRoom);
  await handleRematch({ request: request(room.roomCode, host, room.token, "rematch") });
  const rematch = await handleRematch({ request: request(room.roomCode, guest, joined.token, "rematch") });
  assert.deepEqual(rematch.publicData.players.map((player) => player.name), [
    host.username,
    guest.username,
    lateGuest.username,
  ]);
  assert.equal(rematch.publicData.maxPlayers, 3);
  const promoted = await handleState({
    request: request(room.roomCode, lateGuest, queued.token, "state"),
  });
  assert.equal(promoted.seat, 2);
  assert.equal(promoted.publicData.status, "playing");

  const queuedAgain = await handleJoin({
    request: request(room.roomCode, laterGuest),
    body: {},
  });
  assert.equal(queuedAgain.publicData.queuedForNextMatch, true);
  const queuedSecond = await handleJoin({
    request: request(room.roomCode, secondLaterGuest),
    body: {},
  });
  const queuedThird = await handleJoin({
    request: request(room.roomCode, thirdLaterGuest),
    body: {},
  });
  assert.equal(queuedSecond.seat, -3);
  assert.equal(queuedThird.seat, -4);
  await assert.rejects(
    handleJoin({ request: request(room.roomCode, overLimitGuest), body: {} }),
    (error) => error.status === 403,
  );
  const secondFinishedRoom = await loadRoom(room.roomCode);
  secondFinishedRoom.status = "finished";
  secondFinishedRoom.game.finished = true;
  secondFinishedRoom.rematchRequests = [false, false, false];
  await saveRoom(room.roomCode, secondFinishedRoom);
  const hostStarted = await handleStart({
    request: request(room.roomCode, host, room.token, "start"),
  });
  assert.equal(hostStarted.publicData.players.length, 6);
  assert.equal(hostStarted.publicData.maxPlayers, 6);

  await assert.rejects(
    handleEnd({ request: request(room.roomCode, guest, joined.token, "end") }),
    (error) => error.status === 403,
  );
  const ended = await handleEnd({ request: request(room.roomCode, host, room.token, "end") });
  assert.deepEqual(ended, { closed: true });
  const endedState = await handleState({
    request: request(room.roomCode, guest, joined.token, "state"),
  });
  assert.equal(endedState.publicData.status, "closed");
  await assert.rejects(
    handleJoin({
      request: request(room.roomCode, lateGuest),
      body: {},
    }),
    (error) => error.status === 410,
  );
});
