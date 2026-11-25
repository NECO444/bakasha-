import test from "node:test";
import assert from "node:assert/strict";
import { handleAction, handleCreate, handleJoin, handleRematch, handleStart, handleState } from "../lib/rooms.js";
import { loadRoom, saveRoom } from "../lib/store.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

const request = (code, route, token, account) => accountRequest(
  `/api/rooms/${code}/${route}`,
  account,
  { authorization: `Bearer ${token}` },
);

test("a rematch request notifies the other player and starts after they accept", async () => {
  const host = await createTestAccount("ann");
  const guest = await createTestAccount("ben");
  const created = await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  const code = created.roomCode;
  const joined = await handleJoin({
    request: request(code, "join", created.token, guest),
    body: {},
  });
  await handleStart({ request: request(code, "start", created.token, host) });

  const room = await loadRoom(code);
  room.game.current = 0;
  room.game.hands[0] = [{ id: "hearts-3", suit: "hearts", rank: "3" }];
  room.game.discard = [{ id: "hearts-5", suit: "hearts", rank: "5" }];
  room.game.activeSuit = "hearts";
  room.game.pending = 0;
  room.game.pendingType = null;
  room.game.combo = null;
  room.game.freeSuitPlay = false;
  await saveRoom(code, room);

  await handleAction({
    request: request(code, "action", created.token, host),
    body: { type: "knock", actionId: "knock-rematch-test" },
  });
  const finished = await handleAction({
    request: request(code, "action", created.token, host),
    body: { type: "play", cardId: "hearts-3", actionId: "finish-rematch-test" },
  });
  assert.equal(finished.publicData.status, "finished");
  assert.equal(finished.publicData.game.discard[0].id, "hearts-3");
  await assert.rejects(handleStart({ request: request(code, "start", created.token, host) }), (error) => error.status === 409);

  const requested = await handleRematch({ request: request(code, "rematch", created.token, host) });
  assert.deepEqual(requested.publicData.rematchRequests, [true, false]);
  assert.match(requested.publicData.lastMessage, new RegExp(`${host.username} wants a rematch`));

  const notified = await handleState({ request: request(code, "state", joined.token, guest) });
  assert.deepEqual(notified.publicData.rematchRequests, [true, false]);
  assert.match(notified.publicData.lastMessage, new RegExp(`${host.username} wants a rematch`));

  const accepted = await handleRematch({ request: request(code, "rematch", joined.token, guest) });
  assert.equal(accepted.publicData.status, "playing");
  assert.deepEqual(accepted.publicData.rematchRequests, [false, false]);
  assert.match(accepted.publicData.lastMessage, /Everyone agreed/);
  assert.equal(accepted.ownHand.length, 4);
});

test("rematch requests require a finished game and a room player", async () => {
  const host = await createTestAccount("ann");
  const created = await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  await assert.rejects(handleRematch({ request: request(created.roomCode, "rematch", created.token, host) }), (error) => error.status === 409);
  await assert.rejects(handleRematch({ request: request(created.roomCode, "rematch", "not-a-player", host) }), (error) => error.status === 403);
});


test("a rematch cannot exceed the two-active-room limit", async () => {
  const host = await createTestAccount("rematch_limit_host");
  const guest = await createTestAccount("rematch_limit_guest");
  const finishedRoom = await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  await handleJoin({
    request: request(finishedRoom.roomCode, "join", finishedRoom.token, guest),
    body: {},
  });
  const storedFinishedRoom = await loadRoom(finishedRoom.roomCode);
  storedFinishedRoom.status = "finished";
  storedFinishedRoom.game.finished = true;
  storedFinishedRoom.rematchRequests = [false, false];
  await saveRoom(finishedRoom.roomCode, storedFinishedRoom);

  await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });

  const rejoined = await handleJoin({
    request: request(finishedRoom.roomCode, "join", finishedRoom.token, host),
    body: { token: finishedRoom.token },
  });
  assert.equal(rejoined.publicData.status, "finished");
  await assert.rejects(
    handleRematch({ request: request(finishedRoom.roomCode, "rematch", finishedRoom.token, host) }),
    (error) => error.status === 409 && error.message.includes("maximum of 2"),
  );
  assert.deepEqual((await loadRoom(finishedRoom.roomCode)).rematchRequests, [false, false]);
});
