import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../api/rooms/[...path].js";
import { handleCreate } from "../lib/rooms.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

test("the consolidated room route dispatches join and state requests", async () => {
  const host = await createTestAccount("routehost");
  const guest = await createTestAccount("routeguest");
  const room = await handleCreate({
    request: accountRequest("/api/rooms", host),
    body: {},
  });

  const joinResponse = await POST(
    new Request(`https://example.test/api/rooms/${room.roomCode}/join`, {
      method: "POST",
      headers: {
        cookie: guest.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(joinResponse.status, 200);
  const joined = await joinResponse.json();
  assert.equal(joined.seat, 1);
  assert.equal(typeof joined.token, "string");

  const stateResponse = await GET(
    accountRequest(`/api/rooms/${room.roomCode}/state`, guest, {
      authorization: `Bearer ${joined.token}`,
    }),
  );
  assert.equal(stateResponse.status, 200);
  assert.equal((await stateResponse.json()).seat, 1);
});

test("the consolidated room route rejects unknown paths and unsupported methods", async () => {
  const unknownRoute = await POST(new Request("https://example.test/api/rooms/ABCD/unknown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(unknownRoute.status, 404);

  const unsupportedMethod = await GET(new Request("https://example.test/api/rooms/ABCD/join"));
  assert.equal(unsupportedMethod.status, 404);
});
