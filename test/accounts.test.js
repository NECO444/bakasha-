import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { handleLogin, handleLogout, handleRegister, getAuthenticatedAccount } from "../lib/accounts.js";
import { handleAction, handleCreate, handleJoin, handleStart, handleState } from "../lib/rooms.js";
import { handleLeaderboard } from "../lib/leaderboard.js";
import { loadRoom, saveRoom } from "../lib/store.js";

const username = () => `p${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const requestWithCookie = (path, cookie) => new Request(`https://example.test${path}`, {
  headers: cookie ? { cookie } : {},
});
const roomRequest = (path, cookie, token) => new Request(`https://example.test${path}`, {
  headers: {
    ...(cookie ? { cookie } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
});
const cookieFrom = (response) => response.headers.get("set-cookie").split(";")[0];

test("username-only accounts sign in securely and bind room seats to the account", async () => {
  const firstName = username();
  const firstResponse = await handleRegister({
    request: requestWithCookie("/api/account/register"),
    body: { username: firstName, password: "bakasha-password-1" },
  });
  assert.equal(firstResponse.status, 200);
  assert.match(firstResponse.headers.get("set-cookie"), /HttpOnly/);
  const firstCookie = cookieFrom(firstResponse);
  const firstUser = (await firstResponse.json()).user;

  assert.equal((await getAuthenticatedAccount(requestWithCookie("/api/account", firstCookie))).username, firstName);
  await assert.rejects(
    handleLogin({
      request: requestWithCookie("/api/account/login"),
      body: { username: firstName.toUpperCase(), password: "wrong-password" },
    }),
    (error) => error.status === 401,
  );
  const loginResponse = await handleLogin({
    request: requestWithCookie("/api/account/login"),
    body: { username: firstName.toUpperCase(), password: "bakasha-password-1" },
  });
  assert.equal(loginResponse.status, 200);

  const created = await handleCreate({
    request: requestWithCookie("/api/rooms", firstCookie),
    body: { name: "untrusted room name" },
  });
  assert.equal(created.publicData.players[0].name, firstName);

  await assert.rejects(
    handleCreate({ request: requestWithCookie("/api/rooms"), body: { name: "guest-name" } }),
    (error) => error.status === 401,
  );

  const secondName = username();
  const secondResponse = await handleRegister({
    request: requestWithCookie("/api/account/register"),
    body: { username: secondName, password: "bakasha-password-2" },
  });
  const joined = await handleJoin({
    request: requestWithCookie(`/api/rooms/${created.roomCode}/join`, cookieFrom(secondResponse)),
    body: { name: "also untrusted" },
  });
  assert.equal(joined.publicData.players[1].name, secondName);

  await assert.rejects(
    handleJoin({
      request: requestWithCookie(`/api/rooms/${created.roomCode}/join`, cookieFrom(secondResponse)),
      body: { token: created.token },
    }),
    (error) => error.status === 403,
  );

  const started = await handleStart({
    request: roomRequest(`/api/rooms/${created.roomCode}/start`, firstCookie, created.token),
  });
  await assert.rejects(
    handleState({ request: roomRequest(`/api/rooms/${created.roomCode}/state`, cookieFrom(secondResponse), created.token) }),
    (error) => error.status === 403,
  );
  const room = await loadRoom(created.roomCode);
  room.game.hands = [
    [{ id: "hearts-3", suit: "hearts", rank: "3" }],
    [{ id: "clubs-9", suit: "clubs", rank: "9" }],
  ];
  room.game.discard = [{ id: "hearts-5", suit: "hearts", rank: "5" }];
  room.game.activeSuit = "hearts";
  room.game.current = 0;
  room.game.pending = 0;
  room.game.pendingType = null;
  room.game.combo = null;
  room.game.freeSuitPlay = false;
  room.game.finished = false;
  room.game.winner = null;
  room.game.turnStartedAt = Date.now();
  await saveRoom(created.roomCode, room);

  const finishRequest = roomRequest(`/api/rooms/${created.roomCode}/action`, firstCookie, created.token);
  await handleAction({
    request: finishRequest,
    body: { type: "knock", actionId: "knock-ranked-match" },
  });
  const action = { type: "play", cardId: "hearts-3", actionId: "finish-ranked-match" };
  const finished = await handleAction({ request: finishRequest, body: action });
  assert.equal(finished.publicData.game.finished, true);
  assert.equal(finished.publicData.game.winner, firstName);
  await handleAction({ request: finishRequest, body: action });

  const standings = await handleLeaderboard();
  assert.equal(standings.players.find((player) => player.username === firstName).wins, 1);
  assert.equal(standings.players.find((player) => player.username === secondName).losses, 1);
  assert.equal(started.publicData.status, "playing");

  const logoutResponse = await handleLogout({ request: requestWithCookie("/api/account", firstCookie) });
  assert.match(logoutResponse.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(await getAuthenticatedAccount(requestWithCookie("/api/account", firstCookie)), null);
});
