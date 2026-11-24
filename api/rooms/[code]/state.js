import { handle } from "../../../lib/http.js";
import { handleState } from "../../../lib/rooms.js";

export const GET = handle(handleState);
