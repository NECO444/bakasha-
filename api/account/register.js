import { handle } from "../../lib/http.js";
import { handleRegister } from "../../lib/accounts.js";

export const POST = handle(handleRegister);
