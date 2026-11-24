import { handle } from "../../lib/http.js";
import { handleCurrentAccount, handleLogout } from "../../lib/accounts.js";

export const GET = handle(handleCurrentAccount);
export const DELETE = handle(handleLogout);
