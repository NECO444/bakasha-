import test from "node:test";
import assert from "node:assert/strict";
import { handleCompleteTutorial, handleCurrentAccount } from "../lib/accounts.js";
import { accountRequest, createTestAccount } from "../test-helpers/auth.js";

test("account progress is available only to the signed-in user and tutorial completion persists", async () => {
  const account = await createTestAccount("tutorial");
  await assert.rejects(
    handleCompleteTutorial({ request: accountRequest("/api/account") }),
    (error) => error.status === 401,
  );

  const initial = await handleCurrentAccount({ request: accountRequest("/api/account", account) });
  assert.equal(initial.user.progress.tutorialCompleted, false);
  assert.equal(initial.user.progress.xp, 0);

  const completed = await handleCompleteTutorial({ request: accountRequest("/api/account", account) });
  assert.equal(completed.progress.tutorialCompleted, true);
  const refreshed = await handleCurrentAccount({ request: accountRequest("/api/account", account) });
  assert.equal(refreshed.user.progress.tutorialCompleted, true);
});
