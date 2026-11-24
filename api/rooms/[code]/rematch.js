import { handle } from "../../../lib/http.js";
import { handleRematch } from "../../../lib/rooms.js";

export const POST = handle(handleRematch);
