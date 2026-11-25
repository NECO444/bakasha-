import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadPlayerProgress, recordPlayerProgress } from "../lib/store.js";

test("online match rewards are idempotent and win streak resets on a loss", async () => {
  const suffix = randomUUID().slice(0, 8);
  const winner = { id: `progress-winner-${suffix}`, username: `winner${suffix}` };
  const opponent = { id: `progress-opponent-${suffix}`, username: `opponent${suffix}` };
  const firstGame = {
    gameId: randomUUID(),
    finishedAt: Date.now(),
    winnerId: winner.id,
    players: [winner, opponent],
  };
  const secondGame = { ...firstGame, gameId: randomUUID(), finishedAt: Date.now() + 1 };
  const thirdGame = { ...secondGame, gameId: randomUUID(), finishedAt: Date.now() + 2, winnerId: opponent.id };

  assert.equal(await recordPlayerProgress(firstGame), true);
  assert.equal(await recordPlayerProgress(firstGame), false);
  assert.equal(await recordPlayerProgress(secondGame), true);
  assert.equal(await recordPlayerProgress(thirdGame), true);

  const winnerProgress = await loadPlayerProgress(winner.id, winner.username);
  const opponentProgress = await loadPlayerProgress(opponent.id, opponent.username);
  assert.equal(winnerProgress.xp, 26);
  assert.equal(winnerProgress.wins, 2);
  assert.equal(winnerProgress.losses, 1);
  assert.equal(winnerProgress.streak, 0);
  assert.equal(winnerProgress.bestStreak, 2);
  assert.equal(winnerProgress.history.length, 3);
  assert.equal(opponentProgress.xp, 16);
  assert.equal(opponentProgress.wins, 1);
  assert.equal(opponentProgress.losses, 2);
});
