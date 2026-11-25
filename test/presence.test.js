import test from "node:test";
import assert from "node:assert/strict";
import { handleFriends } from "../lib/friends.js";
import { handlePresence } from "../lib/presence.js";
import { createTestAccount } from "../test-helpers/auth.js";

const request = (path, account, method = "GET") => new Request(`https://example.test${path}`, {
  method,
  headers: account ? { cookie: account.cookie } : {},
});

test("authenticated heartbeats expose online friend status and enforce a cooldown", async () => {
  const alice = await createTestAccount("presalice");
  const bob = await createTestAccount("presbob");
  await handleFriends({
    request: request("/api/friends", alice, "POST"),
    body: { action: "request", username: bob.username },
  });
  await handleFriends({
    request: request("/api/friends", bob, "POST"),
    body: { action: "accept", username: alice.username },
  });

  const heartbeat = await handlePresence({ request: request("/api/presence", bob, "POST") });
  assert.ok(heartbeat.onlineCount >= 1);
  const friends = await handleFriends({ request: request("/api/friends", alice) });
  assert.equal(friends.friends[0].online, true);
  await assert.rejects(
    handlePresence({ request: request("/api/presence", bob, "POST") }),
    (error) => error.status === 429,
  );
  await assert.rejects(
    handlePresence({ request: request("/api/presence", null, "POST") }),
    (error) => error.status === 401,
  );
});
