import { handle } from "../../../lib/http.js";
import { handleAction } from "../../../lib/rooms.js";

export const POST = handle(handleAction);
