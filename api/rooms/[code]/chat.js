import { handle } from "../../../lib/http.js";
import { handleChat } from "../../../lib/rooms.js";

export const POST = handle(handleChat);
