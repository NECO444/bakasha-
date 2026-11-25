import test from "node:test";
import assert from "node:assert/strict";
import { handleFriends } from "../lib/friends.js";
import { handleCreate, handleJoin } from "../lib/rooms.js";
import { createTestAccount } from "../test-helpers/auth.js";

const request = (path, account, method = "GET") => new Request(`https://example.test${path}`, {
  method,
  headers: account ? { cookie: account.cookie } : {},
});

test("friend requests require accounts and become mutual after acceptance", async () => {
  const alice = await createTestAccount("alice");
  const bob = await createTestAccount("bobby");
  await assert.rejects(handleFriends({ request: request("/api/friends", null) }), (error) => error.status === 401);

  const sent = await handleFriends({
    request: request("/api/friends", alice, "POST"),
    body: { action: "request", username: bob.username.toUpperCase() },
  });
  assert.deepEqual(sent.friends, []);
  assert.deepEqual(sent.outgoing, [{ username: bob.username }]);
  const received = await handleFriends({ request: request("/api/friends", bob) });
  assert.deepEqual(received.incoming, [{ username: alice.username }]);

  await assert.rejects(
    handleFriends({ request: request("/api/friends", alice, "POST"), body: { action: "request", username: bob.username } }),
    (error) => error.status === 409,
  );
  await assert.rejects(
    handleFriends({ request: request("/api/friends", alice, "POST"), body: { action: "request", username: alice.username } }),
    (error) => error.status === 400,
  );

  const accepted = await handleFriends({
    request: request("/api/friends", bob, "POST"),
    body: { action: "accept", username: alice.username },
  });
  assert.deepEqual(accepted.friends.map((entry) => entry.username), [alice.username]);
  assert.deepEqual(accepted.incoming, []);
  assert.deepEqual((await handleFriends({ request: request("/api/friends", alice) })).friends.map((entry) => entry.username), [bob.username]);

  const removed = await handleFriends({
    request: request("/api/friends", alice, "DELETE"),
    body: { username: bob.username },
  });
  assert.deepEqual(removed.friends, []);
  assert.deepEqual((await handleFriends({ request: request("/api/friends", bob) })).friends, []);
});

test("unknown and declined requests do not create friend relationships", async () => {
  const alice = await createTestAccount("alice");
  const bob = await createTestAccount("bobby");
  await assert.rejects(
    handleFriends({ request: request("/api/friends", alice, "POST"), body: { action: "request", username: "missing_user" } }),
    (error) => error.status === 404,
  );

  await handleFriends({
    request: request("/api/friends", alice, "POST"),
    body: { action: "request", username: bob.username },
  });
  const declined = await handleFriends({
    request: request("/api/friends", bob, "POST"),
    body: { action: "decline", username: alice.username },
  });
  assert.deepEqual(declined.friends, []);
  assert.deepEqual((await handleFriends({ request: request("/api/friends", alice) })).outgoing, []);
});

test("friends can challenge each other through the in-app inbox using their own private duel", async () => {
  const alice = await createTestAccount("alice");
  const bob = await createTestAccount("bobby");
  const mallory = await createTestAccount("mallory");

  await handleFriends({
    request: request("/api/friends", alice, "POST"),
    body: { action: "request", username: bob.username },
  });
  await handleFriends({
    request: request("/api/friends", bob, "POST"),
    body: { action: "accept", username: alice.username },
  });
  const room = await handleCreate({
    request: request("/api/rooms", alice, "POST"),
    body: { maxPlayers: 2, isPublic: false },
  });

  await assert.rejects(
    handleFriends({
      request: request("/api/friends", mallory, "POST"),
      body: { action: "challenge", username: bob.username, roomCode: room.roomCode },
    }),
    (error) => error.status === 403,
  );
  await assert.rejects(
    handleFriends({
      request: request("/api/friends", bob, "POST"),
      body: { action: "challenge", username: alice.username, roomCode: room.roomCode },
    }),
    (error) => error.status === 409,
  );

  const sent = await handleFriends({
    request: request("/api/friends", alice, "POST"),
    body: { action: "challenge", username: bob.username, roomCode: room.roomCode },
  });
  assert.equal(sent.sentChallenge.username, bob.username);
  assert.equal(sent.sentChallenge.roomCode, room.roomCode);
  const received = await handleFriends({ request: request("/api/friends", bob) });
  assert.equal(received.challenges.length, 1);
  assert.equal(received.challenges[0].id, sent.sentChallenge.id);
  assert.equal(received.challenges[0].roomCode, room.roomCode);
  assert.equal(received.challenges[0].fromUsername, alice.username);

  const joined = await handleJoin({
    request: request(`/api/rooms/${room.roomCode}/join`, bob, "POST"),
    body: {},
  });
  assert.equal(joined.seat, 1);
  assert.equal(joined.publicData.status, "playing");

  const dismissed = await handleFriends({
    request: request("/api/friends", bob, "POST"),
    body: { action: "dismiss-challenge", challengeId: sent.sentChallenge.id },
  });
  assert.deepEqual(dismissed.challenges, []);
});
