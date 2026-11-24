import test from "node:test";
import assert from "node:assert/strict";
import { handleAction, handleCreate, handleJoin, handleRematch, handleStart, handleState } from "../lib/rooms.js";
import { loadRoom, saveRoom } from "../lib/store.js";

const request = (code, route, token) => ({
  url: `https://example.test/api/rooms/${code}/${route}`,
  headers: new Headers({ authorization: `Bearer ${token}` }),
});

test("a rematch request notifies the other player and starts after they accept", async () => {
  const created = await handleCreate({ body: { name: "Ann" } });
  const code = created.roomCode;
  const joined = await handleJoin({
    request: request(code, "join", created.token),
    body: { name: "Ben" },
  });
  await handleStart({ request: request(code, "start", created.token) });

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

  const finished = await handleAction({
    request: request(code, "action", created.token),
    body: { type: "play", cardId: "hearts-3", actionId: "finish-rematch-test" },
  });
  assert.equal(finished.publicData.status, "finished");
  assert.equal(finished.publicData.game.discard[0].id, "hearts-3");
  await assert.rejects(handleStart({ request: request(code, "start", created.token) }), (error) => error.status === 409);

  const requested = await handleRematch({ request: request(code, "rematch", created.token) });
  assert.deepEqual(requested.publicData.rematchRequests, [true, false]);
  assert.match(requested.publicData.lastMessage, /Ann wants a rematch/);

  const notified = await handleState({ request: request(code, "state", joined.token) });
  assert.deepEqual(notified.publicData.rematchRequests, [true, false]);
  assert.match(notified.publicData.lastMessage, /Ann wants a rematch/);

  const accepted = await handleRematch({ request: request(code, "rematch", joined.token) });
  assert.equal(accepted.publicData.status, "playing");
  assert.deepEqual(accepted.publicData.rematchRequests, [false, false]);
  assert.match(accepted.publicData.lastMessage, /Both players agreed/);
  assert.equal(accepted.ownHand.length, 4);
});

test("rematch requests require a finished game and a room player", async () => {
  const created = await handleCreate({ body: { name: "Ann" } });
  await assert.rejects(handleRematch({ request: request(created.roomCode, "rematch", created.token) }), (error) => error.status === 409);
  await assert.rejects(handleRematch({ request: request(created.roomCode, "rematch", "not-a-player") }), (error) => error.status === 403);
});
