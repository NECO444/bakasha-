import { handle } from "../../../lib/http.js";
import { handleJoin } from "../../../lib/rooms.js";

export const POST = handle(handleJoin);
