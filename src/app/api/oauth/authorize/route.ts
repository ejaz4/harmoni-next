import { checkRequest, findClientFor, issueCode, OAuthError, readAuthorizeParams } from "@/server/oauth";
import { publicOrigin } from "@/server/oauth/http";
import { describeRedirect, withParams } from "@/server/oauth/rules";
import { withWebSession } from "@/server/session";

// Behind the consent screen (/oauth/authorize). GET checks the request and
// says who's asking; POST is the person's answer, and says where to send
// them back to. Signed-in web sessions only.

type Checked =
  | { ok: true; app: { name: string; uri: string | null; returnsTo: string; registeredAt: Date }; user: { name: string; username: string } }
  // Can't go back to the app: show it.
  | { ok: false; error: string }
  // Goes back to the app as ?error=.
  | { ok: false; error: string; redirect: string };

// Every answer names this server (RFC 9207), so an app talking to several
// Harmonis can't be tricked into sending one's code to another.
async function check(params: URLSearchParams | Record<string, unknown>, state: string | undefined, iss: string) {
  const p = readAuthorizeParams(params);
  const { client, redirectUri } = await findClientFor(p);
  try {
    return { p, client, redirectUri, scope: checkRequest(p) };
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    const redirect = withParams(redirectUri, { error: err.code, error_description: err.message, state, iss });
    throw Object.assign(err, { redirect });
  }
}

function failure(err: unknown): Response {
  if (!(err instanceof OAuthError)) throw err;
  const redirect = (err as OAuthError & { redirect?: string }).redirect;
  const body: Checked = redirect ? { ok: false, error: err.message, redirect } : { ok: false, error: err.message };
  return Response.json(body, { status: 400 });
}

export const GET = withWebSession(async (request, user) => {
  const params = new URL(request.url).searchParams;
  try {
    const { client, redirectUri } = await check(params, params.get("state") ?? undefined, publicOrigin(request));
    const body: Checked = {
      ok: true,
      app: { name: client.name, uri: client.uri, returnsTo: describeRedirect(redirectUri), registeredAt: client.createdAt },
      user: { name: user.name, username: user.username },
    };
    return Response.json(body);
  } catch (err) {
    return failure(err);
  }
});

export const POST = withWebSession(async (request, user) => {
  // Only this site's own consent screen can answer. (The session cookie is
  // SameSite=Lax, so another site's form couldn't carry it anyway.)
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ error: "Not from here." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const state = typeof body.state === "string" ? body.state : undefined;
  const iss = publicOrigin(request);
  try {
    const { p, client, redirectUri, scope } = await check(body, state, iss);
    if (body.allow !== true) {
      return Response.json({ redirect: withParams(redirectUri, { error: "access_denied", error_description: "They said no.", state, iss }) });
    }
    const code = await issueCode(user.id, client.id, redirectUri, p.codeChallenge, scope);
    return Response.json({ redirect: withParams(redirectUri, { code, state, iss }) });
  } catch (err) {
    return failure(err);
  }
});
