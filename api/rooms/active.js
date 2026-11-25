import { handle } from "../../lib/http.js";
import { handleActiveRoomAction, handleListActiveRooms } from "../../lib/rooms.js";

export const GET = handle(handleListActiveRooms);
export const POST = handle(handleActiveRoomAction);
