import { handle, HttpError } from "../../../lib/http.js";
import {
  handleAction,
  handleChat,
  handleEnd,
  handleJoin,
  handleRematch,
  handleStart,
  handleState,
} from "../../../lib/rooms.js";

const routes = {
  state: { GET: handleState },
  join: { POST: handleJoin },
  start: { POST: handleStart },
  rematch: { POST: handleRematch },
  end: { POST: handleEnd },
  action: { POST: handleAction },
  chat: { POST: handleChat },
};

const dispatch = handle(({ request, body }) => {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean).slice(2);
  if (segments.length !== 2) throw new HttpError(404, "Not found.");

  const route = routes[segments[1]];
  const routeHandler = route?.[request.method];
  if (!routeHandler) throw new HttpError(404, "Not found.");
  return routeHandler({ request, body });
});

export const GET = dispatch;
export const POST = dispatch;
