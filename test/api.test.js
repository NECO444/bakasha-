import test from "node:test";
import assert from "node:assert/strict";
import { handleAction, handleCreate, handleJoin, handleStart, handleState } from "../lib/rooms.js";
import { HttpError } from "../lib/http.js";

const req = (code, path, token) => ({
  url: `https://example.test/api/rooms/${code}/${path}`,
  headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
});

test("full room flow: create, join, start, play, privacy, reconnect", async () => {
  const created = await handleCreate({ body: { name: "  Ann  " } });
  assert.equal(created.seat, 0);
  assert.match(created.roomCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
  const code = created.roomCode;

  await assert.rejects(handleStart({ request: req(code, "start", created.token) }), (e) => e instanceof HttpError && e.status === 409);

  const joined = await handleJoin({ request: req(code, "join"), body: { name: "Ben" } });
  assert.equal(joined.seat, 1);
  await assert.rejects(handleJoin({ request: req(code, "join"), body: { name: "Cy" } }), (e) => e.status === 403);

  // reconnect with a saved token needs no name
  const again = await handleJoin({ request: req(code, "join"), body: { token: joined.token } });
  assert.equal(again.seat, 1);

  await assert.rejects(handleStart({ request: req(code, "start", joined.token) }), (e) => e.status === 403);
  const started = await handleStart({ request: req(code, "start", created.token) });
  assert.equal(started.publicData.status, "playing");
  assert.equal(started.ownHand.length, 4);

  const guestView = await handleState({ request: req(code, "state", joined.token) });
  const hostText = JSON.stringify(started.publicData);
  const guestText = JSON.stringify(guestView.publicData);
  for (const card of [...started.ownHand, ...guestView.ownHand]) {
    if (card.id !== started.publicData.game.discard[0].id) {
      assert.ok(!hostText.includes(card.id) && !guestText.includes(card.id), "hands must not leak into public data");
    }
  }
  assert.notDeepEqual(started.ownHand, guestView.ownHand);

  await assert.rejects(handleState({ request: req(code, "state", "nope") }), (e) => e.status === 403);
  await assert.rejects(handleAction({ request: req(code, "action", joined.token), body: { type: "draw", actionId: "a1" } }), (e) => e.status === 400);

  const moved = await handleAction({ request: req(code, "action", created.token), body: { type: "draw", actionId: "a2" } });
  assert.equal(moved.ownHand.length >= 4, true);
  const retried = await handleAction({ request: req(code, "action", created.token), body: { type: "draw", actionId: "a2" } });
  assert.equal(retried.publicData.version, moved.publicData.version, "retrying the same action id must not apply twice");
});

test("invalid room codes and names are rejected", async () => {
  await assert.rejects(handleState({ request: req("short", "state", "x") }), (e) => e.status === 400);
  await assert.rejects(handleCreate({ body: { name: "" } }), (e) => e.status === 400);
  await assert.rejects(handleCreate({ body: { name: "x".repeat(17) } }), (e) => e.status === 400);
});
