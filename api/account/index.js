import { handle } from "../../lib/http.js";
import { handleCompleteTutorial, handleCurrentAccount, handleLogout } from "../../lib/accounts.js";

export const GET = handle(handleCurrentAccount);
export const POST = handle(handleCompleteTutorial);
export const DELETE = handle(handleLogout);
