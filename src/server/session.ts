import { auth } from "./auth";

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: string;
}

// Every API route calls this: the session is checked close to the data,
// never trusted from the client or the proxy's cookie check.
export async function getUser(request: Request): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const u = session.user as typeof session.user & { username?: string | null; role?: string };
  return { id: u.id, username: u.username ?? u.name, name: u.name, role: u.role ?? "user" };
}

export class Unauthorized extends Error {}

export async function requireUser(request: Request): Promise<CurrentUser> {
  const user = await getUser(request);
  if (!user) throw new Unauthorized();
  return user;
}

// Wraps a route handler: 401 for signed-out requests, the user otherwise.
export function withUser<C>(
  handler: (request: Request, user: CurrentUser, ctx: C) => Promise<Response>,
): (request: Request, ctx: C) => Promise<Response> {
  return async (request, ctx) => {
    const user = await getUser(request);
    if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
    return handler(request, user, ctx);
  };
}
