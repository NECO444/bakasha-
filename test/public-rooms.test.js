import test from "node:test";
import assert from "node:assert/strict";
import { handleCreate, handleJoin, handleListPublicRooms, handleStart } from "../lib/rooms.js";
import { loadRoom, saveRoom } from "../lib/store.js";

const request = (code, token) => ({
  url: `https://example.test/api/rooms/${code}/join`,
  headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
});

test("public lobby lists only active public waiting rooms without room credentials", async () => {
  const privateRoom = await handleCreate({ body: { name: "Private host" } });
  const publicRoom = await handleCreate({ body: { name: "Public host", isPublic: true } });
  const rooms = await handleListPublicRooms();

  assert.deepEqual(rooms.rooms.map((room) => room.roomCode), [publicRoom.roomCode]);
  assert.equal(rooms.rooms[0].hostName, "Public host");
  assert.equal(rooms.rooms[0].playerCount, 1);
  assert.equal(JSON.stringify(rooms).includes(publicRoom.token), false);
  assert.equal(JSON.stringify(rooms).includes(privateRoom.roomCode), false);

  const joined = await handleJoin({
    request: request(publicRoom.roomCode),
    body: { name: "Guest", publicJoin: true },
  });
  assert.equal(joined.seat, 1);
  assert.equal((await handleListPublicRooms()).rooms.some((room) => room.roomCode === publicRoom.roomCode), false);

  await assert.rejects(
    handleJoin({
      request: request(privateRoom.roomCode),
      body: { name: "Guest", publicJoin: true },
    }),
    (error) => error.status === 404,
  );
});

test("public lobby hides inactive hosts but allows joining a still-waiting room", async () => {
  const inactiveRoom = await handleCreate({ body: { name: "Away host", isPublic: true } });
  const inactiveData = await loadRoom(inactiveRoom.roomCode);
  inactiveData.players[0].lastSeenAt -= 31_000;
  await saveRoom(inactiveRoom.roomCode, inactiveData);
  assert.equal((await handleListPublicRooms()).rooms.some((room) => room.roomCode === inactiveRoom.roomCode), false);
  const joinedInactiveRoom = await handleJoin({
    request: request(inactiveRoom.roomCode),
    body: { name: "Guest", publicJoin: true },
  });
  assert.equal(joinedInactiveRoom.seat, 1);

  const activeRoom = await handleCreate({ body: { name: "Playing host", isPublic: true } });
  const joined = await handleJoin({
    request: request(activeRoom.roomCode),
    body: { name: "Guest", publicJoin: true },
  });
  await handleStart({
    request: {
      ...request(activeRoom.roomCode, activeRoom.token),
      url: `https://example.test/api/rooms/${activeRoom.roomCode}/start`,
    },
  });

  const rooms = await handleListPublicRooms();
  assert.equal(rooms.rooms.some((room) => room.roomCode === inactiveRoom.roomCode), false);
  assert.equal(rooms.rooms.some((room) => room.roomCode === activeRoom.roomCode), false);
  assert.equal(joined.seat, 1);
});
