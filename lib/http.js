export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// Wraps a handler({ request, body }) that returns plain JSON data.
export function handle(fn) {
  return async (request) => {
    try {
      let body = {};
      if (request.method !== "GET") {
        try {
          body = await request.json();
        } catch (error) {
          body = {};
        }
      }
      if (!body || typeof body !== "object") body = {};
      const result = await fn({ request, body });
      return result instanceof Response ? result : json(result);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "The game server hit an unexpected error." }, 500);
    }
  };
}
