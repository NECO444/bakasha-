import { metric } from "@vercel/functions";
import { getAuthenticatedAccount } from "./accounts.js";
import { HttpError } from "./http.js";
import { publishOnlinePresence } from "./store.js";

export async function handlePresence({ request }) {
  const startedAt = performance.now();
  let outcome = "error";
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) throw new HttpError(401, "Sign in to update your presence.");
    const onlineCount = await publishOnlinePresence(account.id);
    if (onlineCount === null) throw new HttpError(429, "Presence was updated too recently.");
    outcome = "success";
    return { onlineCount };
  } catch (error) {
    outcome = error instanceof HttpError ? "rejected" : "error";
    throw error;
  } finally {
    metric("bakasha.presence.heartbeat.requests", 1, { outcome });
    metric("bakasha.presence.heartbeat.duration_ms", performance.now() - startedAt, { outcome });
  }
}
