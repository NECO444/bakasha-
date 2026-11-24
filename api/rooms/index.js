import { handle } from "../../lib/http.js";
import { handleCreate } from "../../lib/rooms.js";

export const POST = handle(handleCreate);
