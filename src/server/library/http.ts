import { BadRequest, NotFound } from "./service";

// Turns library errors into HTTP responses.
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFound) return Response.json({ error: "Not found." }, { status: 404 });
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}

export const SONG_ID = /^[0-9a-f-]{36}$/;
