import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handleLeaderboard } from "../lib/leaderboard.js";
import { LEADERBOARD_WINDOW_MS, recordLeaderboardMatch } from "../lib/store.js";

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

  const expiredAt = Date.now() - LEADERBOARD_WINDOW_MS - 1;
  assert.equal(await recordLeaderboardMatch({
    ...match,
    gameId: randomUUID(),
    finishedAt: expiredAt,
  }), false);
  const refreshed = await handleLeaderboard();
  assert.equal(refreshed.players.find((player) => player.username === winner.username).wins, 1);
});
