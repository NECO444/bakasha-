import { handle } from "../../lib/http.js";
import { handleCreate, handleListPublicRooms } from "../../lib/rooms.js";

export const GET = handle(handleListPublicRooms);
export const POST = handle(handleCreate);
