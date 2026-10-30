import { auth } from "./auth";
import { getServerSettings } from "./settings";

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: string;
  // As they've set them, and only while this server has the feature on.
  superProcessing: boolean;
  autoplay: boolean;
}

// Every API route calls this: the session is checked close to the data,
// never trusted from the client or the proxy's cookie check.
export async function getUser(request: Request): Promise<CurrentUser | null> {
  const [session, settings] = await Promise.all([auth.api.getSession({ headers: request.headers }), getServerSettings()]);
  if (!session) return null;
  const u = session.user as typeof session.user & { username?: string | null; role?: string; superProcessing?: boolean; autoplay?: boolean };
  return {
    id: u.id,
    username: u.username ?? u.name,
    name: u.name,
    role: u.role ?? "user",
    superProcessing: (u.superProcessing ?? false) && settings.features.superProcessing,
    autoplay: (u.autoplay ?? false) && settings.features.autoplay,
  };
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

// The same, for admins only.
export function withAdmin<C>(
  handler: (request: Request, user: CurrentUser, ctx: C) => Promise<Response>,
): (request: Request, ctx: C) => Promise<Response> {
  return withUser((request, user, ctx: C) => {
    if (user.role !== "admin") return Promise.resolve(Response.json({ error: "Only admins can do that." }, { status: 403 }));
    return handler(request, user, ctx);
  });
}
