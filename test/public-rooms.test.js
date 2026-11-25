import test from "node:test";
import assert from "node:assert/strict";
import { handleCreate, handleJoin, handleListPublicRooms, handleStart } from "../lib/rooms.js";
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
  const inactiveRoom = await handleCreate({ request: accountRequest("/api/rooms", inactiveHost), body: { isPublic: true } });
  const inactiveData = await loadRoom(inactiveRoom.roomCode);
  inactiveData.players[0].lastSeenAt -= 31_000;
  await saveRoom(inactiveRoom.roomCode, inactiveData);
  assert.equal((await handleListPublicRooms()).rooms.some((room) => room.roomCode === inactiveRoom.roomCode), false);
  const joinedInactiveRoom = await handleJoin({
    request: request(inactiveRoom.roomCode, guest),
    body: { publicJoin: true },
  });
  assert.equal(joinedInactiveRoom.seat, 1);

  const activeRoom = await handleCreate({ request: accountRequest("/api/rooms", activeHost), body: { isPublic: true } });
  const joined = await handleJoin({
    request: request(activeRoom.roomCode, guest),
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
