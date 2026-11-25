import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../api/account/[action].js";

test("account login and registration paths dispatch to their handlers", async () => {
  for (const action of ["login", "register"]) {
    const response = await POST(new Request(`https://example.test/api/account/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(response.status, 400, `${action} should reach its handler validation`);
  }
});

test("unknown account action returns not found", async () => {
  const response = await POST(new Request("https://example.test/api/account/unknown", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(response.status, 404);
});
