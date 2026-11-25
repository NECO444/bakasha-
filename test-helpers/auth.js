import { randomBytes } from "node:crypto";
import { handleRegister } from "../lib/accounts.js";

export async function createTestAccount(prefix = "player") {
  const username = `${prefix.slice(0, 7)}${randomBytes(4).toString("hex")}`.toLowerCase();
  const response = await handleRegister({
    request: new Request("https://example.test/api/account/register"),
    body: { username, password: "bakasha-test-password" },
  });
  return {
    username,
    cookie: response.headers.get("set-cookie").split(";")[0],
  };
}

export function accountRequest(path, account, headers = {}) {
  return new Request(`https://example.test${path}`, {
    headers: {
      ...(account ? { cookie: account.cookie } : {}),
      ...headers,
    },
  });
}
