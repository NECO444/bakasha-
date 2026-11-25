import { handle } from "../../lib/http.js";
import { handleFriends } from "../../lib/friends.js";

export const GET = handle(handleFriends);
export const POST = handle(handleFriends);
export const DELETE = handle(handleFriends);
