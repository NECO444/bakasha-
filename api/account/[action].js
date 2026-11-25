import { handle, HttpError } from "../../lib/http.js";
import { handleLogin, handleRegister } from "../../lib/accounts.js";

export const POST = handle(({ request, body }) => {
  const action = new URL(request.url).pathname.split("/").filter(Boolean).pop();
  if (action === "login") return handleLogin({ request, body });
  if (action === "register") return handleRegister({ request, body });
  throw new HttpError(404, "Not found.");
});
