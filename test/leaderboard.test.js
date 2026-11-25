import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getAuthenticatedAccount } from "../lib/accounts.js";
import { handleFriends } from "../lib/friends.js";
import { handleLeaderboard } from "../lib/leaderboard.js";
import { LEADERBOARD_WINDOW_MS, recordLeaderboardMatch } from "../lib/store.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

test("leaderboard counts each ranked match once and ignores results older than four weeks", async () => {
  const suffix = randomUUID().slice(0, 8);
  const winner = { id: `winner-${suffix}`, username: `winner${suffix}` };
  const loser = { id: `loser-${suffix}`, username: `loser${suffix}` };
  const match = {
    gameId: randomUUID(),
    finishedAt: Date.now(),
    winnerId: winner.id,
    players: [winner, loser],
  };

  assert.equal(await recordLeaderboardMatch(match), true);
  assert.equal(await recordLeaderboardMatch(match), false);
  const standings = await handleLeaderboard();
  const winnerStanding = standings.players.find((player) => player.username === winner.username);
  assert.equal(winnerStanding.wins, 1);
  assert.equal(winnerStanding.losses, 0);
  assert.equal(winnerStanding.games, 1);
  assert.equal(winnerStanding.winRate, 100);
  assert.equal(standings.players.find((player) => player.username === loser.username).losses, 1);

  const allTime = await handleLeaderboard({
    request: new Request("https://bakasha.test/api/leaderboard?period=all-time"),
  });
  assert.equal(allTime.players.find((player) => player.username === winner.username).wins, 1);
  assert.equal(allTime.period, "all-time");

  const expiredAt = Date.now() - LEADERBOARD_WINDOW_MS - 1;
  assert.equal(await recordLeaderboardMatch({
    ...match,
    gameId: randomUUID(),
    finishedAt: expiredAt,
  }), false);
  const refreshed = await handleLeaderboard();
  assert.equal(refreshed.players.find((player) => player.username === winner.username).wins, 1);
});

test("friends leaderboard is limited to the signed-in player's friend circle", async () => {
  const alice = await createTestAccount("friendslb");
  const bob = await createTestAccount("friendslb");
  const stranger = await createTestAccount("friendslb");
  const aliceAccount = await getAuthenticatedAccount(accountRequest("/api/account", alice));
  const bobAccount = await getAuthenticatedAccount(accountRequest("/api/account", bob));
  const strangerAccount = await getAuthenticatedAccount(accountRequest("/api/account", stranger));
  const postAs = (account) => new Request("https://example.test/api/friends", {
    method: "POST",
    headers: { cookie: account.cookie },
  });

  await handleFriends({
    request: postAs(alice),
    body: { action: "request", username: bob.username },
  });
  await handleFriends({
    request: postAs(bob),
    body: { action: "accept", username: alice.username },
  });
  await recordLeaderboardMatch({
    gameId: randomUUID(),
    finishedAt: Date.now(),
    winnerId: aliceAccount.id,
    players: [
      { id: aliceAccount.id, username: alice.username },
      { id: bobAccount.id, username: bob.username },
    ],
  });
  await recordLeaderboardMatch({
    gameId: randomUUID(),
    finishedAt: Date.now(),
    winnerId: strangerAccount.id,
    players: [
      { id: strangerAccount.id, username: stranger.username },
      { id: bobAccount.id, username: bob.username },
    ],
  });

  const friends = await handleLeaderboard({
    request: accountRequest("/api/leaderboard?period=friends", alice),
  });
  assert.deepEqual(friends.players.map((player) => player.username).sort(), [alice.username, bob.username].sort());
  assert.equal(friends.currentUser.username, alice.username);
  await assert.rejects(
    handleLeaderboard({ request: new Request("https://bakasha.test/api/leaderboard?period=friends") }),
    (error) => error.status === 401,
  );
});
