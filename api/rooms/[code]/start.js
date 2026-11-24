import { handle } from "../../../lib/http.js";
import { handleStart } from "../../../lib/rooms.js";

export const POST = handle(handleStart);
