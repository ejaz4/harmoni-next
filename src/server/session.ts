import { auth } from "./auth";
import { authenticate } from "./oauth";
import { getServerSettings } from "./settings";

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: string;
  // As they've set them, and only while this server has the feature on.
  superProcessing: boolean;
  autoplay: boolean;
  // Set when an app is calling with an access token, not the web app with
  // its session cookie. Apps get everything but server settings and
  // account security (see withAdmin and withWebSession).
  app?: { id: string; name: string; grantId: string };
}

const bearer = (request: Request) => request.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

// Every API route calls this: the session is checked close to the data,
// never trusted from the client or the proxy's cookie check.
export async function getUser(request: Request): Promise<CurrentUser | null> {
  const token = bearer(request);
  // A request with a token stands or falls by it: never the cookie instead.
  if (token) {
    const [found, settings] = await Promise.all([authenticate(token), getServerSettings()]);
    if (!found) return null;
    const { user: u, grant } = found;
    return {
      id: u.id,
      username: u.username ?? u.name,
      name: u.name,
      role: u.role,
      superProcessing: u.superProcessing && settings.features.superProcessing,
      autoplay: u.autoplay && settings.features.autoplay,
      app: { id: grant.client.id, name: grant.client.name, grantId: grant.id },
    };
  }
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
    if (!user) {
      const res = Response.json({ error: "Sign in first." }, { status: 401 });
      // RFC 6750: tells an app its token is the problem (so refresh it).
      if (bearer(request)) res.headers.set("WWW-Authenticate", 'Bearer error="invalid_token", error_description="The access token expired or was revoked."');
      return uncached(res);
    }
    return uncached(await handler(request, user, ctx));
  };
}

// A failure is about this moment: never let a browser keep it and answer a
// retry with it.
function uncached(res: Response): Response {
  if (!res.ok && !res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
  return res;
}

// The same, for admins only, and only on the web: apps never get server settings.
export function withAdmin<C>(
  handler: (request: Request, user: CurrentUser, ctx: C) => Promise<Response>,
): (request: Request, ctx: C) => Promise<Response> {
  return withUser((request, user, ctx: C) => {
    if (user.app) return Promise.resolve(Response.json({ error: "Server settings are only on the web." }, { status: 403 }));
    if (user.role !== "admin") return Promise.resolve(Response.json({ error: "Only admins can do that." }, { status: 403 }));
    return handler(request, user, ctx);
  });
}

// Signed in on the web, not an app: for managing which apps are connected.
export function withWebSession<C>(
  handler: (request: Request, user: CurrentUser, ctx: C) => Promise<Response>,
): (request: Request, ctx: C) => Promise<Response> {
  return withUser((request, user, ctx: C) => {
    if (user.app) return Promise.resolve(Response.json({ error: "That's only on the web." }, { status: 403 }));
    return handler(request, user, ctx);
  });
}
