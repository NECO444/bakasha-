import test from "node:test";
import assert from "node:assert/strict";
import { handleAction, handleChat, handleCreate, handleJoin, handleStart, handleState } from "../lib/rooms.js";
import { loadRoom, saveRoom } from "../lib/store.js";

const req = (code, token) => ({
  url: `https://example.test/api/rooms/${code}/chat`,
  headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
});

test("room chat is private to players, bounded, and cleared when the game ends", async () => {
  const created = await handleCreate({ body: { name: "Ann" } });
  const code = created.roomCode;
  const joined = await handleJoin({
    request: { url: `https://example.test/api/rooms/${code}/join`, headers: new Headers() },
    body: { name: "Ben" },
  });

  await assert.rejects(handleChat({ request: req(code, created.token), body: { message: "Too early" } }), (error) => error.status === 409);

  await handleStart({
    request: { url: `https://example.test/api/rooms/${code}/start`, headers: new Headers({ authorization: `Bearer ${created.token}` }) },
  });
  const sent = await handleChat({ request: req(code, created.token), body: { message: "  hello\u0007 friend  " } });
  assert.equal(sent.publicData.chatMessages.length, 1);
  assert.equal(sent.publicData.chatMessages[0].text, "hello friend");
  assert.equal(sent.publicData.chatMessages[0].seat, 0);

  const guestState = await handleState({
    request: { url: `https://example.test/api/rooms/${code}/state`, headers: new Headers({ authorization: `Bearer ${joined.token}` }) },
  });
  assert.equal(guestState.publicData.chatMessages[0].name, "Ann");
  await assert.rejects(handleChat({ request: req(code, "not-a-player"), body: { message: "Secret" } }), (error) => error.status === 403);
  await assert.rejects(handleChat({ request: req(code, created.token), body: { message: "  " } }), (error) => error.status === 400);
  await assert.rejects(handleChat({ request: req(code, created.token), body: { message: "x".repeat(281) } }), (error) => error.status === 400);

  const room = await loadRoom(code);
  const winnerSeat = room.game.current;
  const winnerToken = winnerSeat === 0 ? created.token : joined.token;
  room.game.hands[winnerSeat] = [{ id: "hearts-3", suit: "hearts", rank: "3" }];
  room.game.discard = [{ id: "hearts-5", suit: "hearts", rank: "5" }];
  room.game.activeSuit = "hearts";
  room.game.pending = 0;
  room.game.pendingType = null;
  room.game.combo = null;
  room.game.freeSuitPlay = false;
  await saveRoom(code, room);

  const finished = await handleAction({
    request: { url: `https://example.test/api/rooms/${code}/action`, headers: new Headers({ authorization: `Bearer ${winnerToken}` }) },
    body: { type: "play", cardId: "hearts-3", actionId: "finish-chat-game" },
  });
  assert.equal(finished.publicData.status, "finished");
  assert.deepEqual(finished.publicData.chatMessages, []);
  assert.deepEqual((await loadRoom(code)).chatMessages, []);
  await assert.rejects(handleChat({ request: req(code, created.token), body: { message: "After the game" } }), (error) => error.status === 409);
});
