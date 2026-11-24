import { handle } from "../../lib/http.js";
import { handleLogin } from "../../lib/accounts.js";

export const POST = handle(handleLogin);
