import test from "node:test";
import assert from "node:assert/strict";
import { handleAction, handleChat, handleCreate, handleJoin, handleState } from "../lib/rooms.js";
import { loadRoom, saveRoom } from "../lib/store.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

const req = (code, token, account, route = "chat") => accountRequest(
  `/api/rooms/${code}/${route}`,
  account,
  token ? { authorization: `Bearer ${token}` } : {},
);

test("room chat is private to players, bounded, and cleared when the game ends", async () => {
  const host = await createTestAccount("ann");
  const guest = await createTestAccount("ben");
  const created = await handleCreate({ request: accountRequest("/api/rooms", host), body: {} });
  const code = created.roomCode;
  await assert.rejects(handleChat({ request: req(code, created.token, host), body: { message: "Too early" } }), (error) => error.status === 409);

  const joined = await handleJoin({
    request: req(code, null, guest, "join"),
    body: {},
  });

  assert.equal(joined.publicData.status, "playing");
  const sent = await handleChat({ request: req(code, created.token, host), body: { message: "  hello\u0007 friend  " } });
  assert.equal(sent.publicData.chatMessages.length, 1);
  assert.equal(sent.publicData.chatMessages[0].text, "hello friend");
  assert.equal(sent.publicData.chatMessages[0].seat, 0);

  const guestState = await handleState({
    request: req(code, joined.token, guest, "state"),
  });
  assert.equal(guestState.publicData.chatMessages[0].name, host.username);
  await assert.rejects(handleChat({ request: req(code, "not-a-player", host), body: { message: "Secret" } }), (error) => error.status === 403);
  await assert.rejects(handleChat({ request: req(code, created.token, host), body: { message: "  " } }), (error) => error.status === 400);
  await assert.rejects(handleChat({ request: req(code, created.token, host), body: { message: "x".repeat(281) } }), (error) => error.status === 400);

  const room = await loadRoom(code);
  const winnerSeat = room.game.current;
  const winnerToken = winnerSeat === 0 ? created.token : joined.token;
  const winnerAccount = winnerSeat === 0 ? host : guest;
  room.game.hands[winnerSeat] = [{ id: "hearts-3", suit: "hearts", rank: "3" }];
  room.game.discard = [{ id: "hearts-5", suit: "hearts", rank: "5" }];
  room.game.activeSuit = "hearts";
  room.game.pending = 0;
  room.game.pendingType = null;
  room.game.combo = null;
  room.game.freeSuitPlay = false;
  await saveRoom(code, room);

  await handleAction({
    request: req(code, winnerToken, winnerAccount, "action"),
    body: { type: "knock", actionId: "knock-chat-game" },
  });
  const finished = await handleAction({
    request: req(code, winnerToken, winnerAccount, "action"),
    body: { type: "play", cardId: "hearts-3", actionId: "finish-chat-game" },
  });
  assert.equal(finished.publicData.status, "finished");
  assert.deepEqual(finished.publicData.chatMessages, []);
  assert.deepEqual((await loadRoom(code)).chatMessages, []);
  await assert.rejects(handleChat({ request: req(code, created.token, host), body: { message: "After the game" } }), (error) => error.status === 409);
});
