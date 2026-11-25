import { handle } from "../lib/http.js";
import { handlePresence } from "../lib/presence.js";

export const POST = handle(handlePresence);
