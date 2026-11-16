import { db } from "../db";
import {
  ACCESS_TTL_S,
  CODE_TTL_S,
  grantScope,
  hashToken,
  newClientId,
  newToken,
  redirectMatches,
  redirectProblem,
  REFRESH_TTL_S,
  REUSE_GRACE_S,
  validChallenge,
  verifierMatches,
} from "./rules";

// Harmoni's OAuth 2.0 server, for apps: authorization code + PKCE (RFC 6749,
// 7636, 8252), dynamic client registration (RFC 7591), revocation (RFC 7009).
// Apps get everything the web app can do but server settings (and account
// security: password, sessions, other apps), checked in ../session.ts.
// docs/api/README.md is the guide for app developers.

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const seconds = (s: number) => new Date(Date.now() + s * 1000);

// --- Registering an app ---

export interface ClientMetadata {
  client_name?: unknown;
  redirect_uris?: unknown;
  client_uri?: unknown;
  logo_uri?: unknown;
  software_id?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  scope?: unknown;
}

const optionalHttps = (v: unknown, field: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 512 || !/^https:\/\/[^\s]+$/.test(v)) throw new OAuthError("invalid_client_metadata", `${field} must be an https URL.`);
  return v;
};

const subset = (v: unknown, allowed: string[], field: string) => {
  if (v === undefined) return;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && allowed.includes(x))) {
    throw new OAuthError("invalid_client_metadata", `${field} can only include ${allowed.join(", ")}.`);
  }
};

export async function registerClient(meta: ClientMetadata) {
  const name = typeof meta.client_name === "string" ? meta.client_name.trim() : "";
  if (!name || name.length > 60) throw new OAuthError("invalid_client_metadata", "client_name is required, up to 60 characters.");
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5) throw new OAuthError("invalid_redirect_uri", "redirect_uris needs one to five URIs.");
  for (const uri of uris) {
    const problem = redirectProblem(uri);
    if (problem) throw new OAuthError("invalid_redirect_uri", problem);
  }
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== "none") {
    throw new OAuthError("invalid_client_metadata", 'Only public clients: token_endpoint_auth_method must be "none".');
  }
  subset(meta.grant_types, ["authorization_code", "refresh_token"], "grant_types");
  subset(meta.response_types, ["code"], "response_types");
  if (meta.scope !== undefined && (typeof meta.scope !== "string" || !grantScope(meta.scope))) throw new OAuthError("invalid_client_metadata", "The only scope is harmoni.");
  const softwareId = typeof meta.software_id === "string" ? meta.software_id.slice(0, 100) : null;

  // Registering is open to anyone, so apps that never got as far as being
  // allowed in don't pile up.
  await db.oAuthClient.deleteMany({ where: { createdAt: { lt: seconds(-24 * 60 * 60) }, grants: { none: {} }, codes: { none: {} } } });
  const client = await db.oAuthClient.create({
    data: { id: newClientId(), name, redirectUris: uris as string[], uri: optionalHttps(meta.client_uri, "client_uri"), logoUri: optionalHttps(meta.logo_uri, "logo_uri"), softwareId },
  });
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "harmoni",
    ...(client.uri && { client_uri: client.uri }),
    ...(client.logoUri && { logo_uri: client.logoUri }),
    ...(client.softwareId && { software_id: client.softwareId }),
  };
}

// --- The consent screen ---

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
}

export function readAuthorizeParams(params: URLSearchParams | Record<string, unknown>): AuthorizeParams {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return typeof v === "string" ? v : "";
  };
  return {
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    responseType: get("response_type"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    scope: get("scope") || null,
  };
}

// Problems that can't be sent back to the app, because it isn't one this
// server knows or the redirect isn't its own: the person is told instead.
export async function findClientFor(p: AuthorizeParams) {
  const client = p.clientId ? await db.oAuthClient.findUnique({ where: { id: p.clientId } }) : null;
  if (!client) throw new OAuthError("invalid_client", "This app isn't registered with this server. It may have been set up for a different one.");
  // One registered redirect can be left out; more, and the app must say which.
  const redirectUri = p.redirectUri || (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) throw new OAuthError("invalid_request", "This app asked to be sent somewhere it didn't register, so Harmoni won't send you there.");
  return { client, redirectUri };
}

// Problems the app made, which go back to it as ?error=.
export function checkRequest(p: AuthorizeParams): string {
  if (p.responseType !== "code") throw new OAuthError("unsupported_response_type", "Only response_type=code.");
  if (p.codeChallengeMethod !== "S256" || !validChallenge(p.codeChallenge)) throw new OAuthError("invalid_request", "PKCE is required: code_challenge with code_challenge_method=S256.");
  const scope = grantScope(p.scope);
  if (!scope) throw new OAuthError("invalid_scope", "The only scope is harmoni.");
  return scope;
}

export async function issueCode(userId: string, clientId: string, redirectUri: string, codeChallenge: string, scope: string): Promise<string> {
  const code = newToken("hac");
  await db.oAuthCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthCode.create({ data: { codeHash: hashToken(code), clientId, userId, redirectUri, codeChallenge, scope, expiresAt: seconds(CODE_TTL_S) } });
  return code;
}

// --- Tokens ---

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function freshTokens() {
  const access = newToken("hat");
  const refresh = newToken("hrt");
  return {
    access,
    refresh,
    data: { accessHash: hashToken(access), accessExpiresAt: seconds(ACCESS_TTL_S), refreshHash: hashToken(refresh), refreshExpiresAt: seconds(REFRESH_TTL_S) },
  };
}

const response = (t: { access: string; refresh: string }, scope: string): TokenResponse => ({
  access_token: t.access,
  token_type: "Bearer",
  expires_in: ACCESS_TTL_S,
  refresh_token: t.refresh,
  scope,
});

const suspended = async (userId: string) => !!(await db.user.findUnique({ where: { id: userId }, select: { suspended: true } }))?.suspended;

export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string; device?: string }): Promise<TokenResponse> {
  const invalid = () => new OAuthError("invalid_grant", "That code isn't valid any more. Start signing in again.");
  if (!input.code) throw new OAuthError("invalid_request", "code is required.");
  // Deleting it is what makes it one-time: of two racing requests, one finds nothing.
  const row = await db.oAuthCode.delete({ where: { codeHash: hashToken(input.code) } }).catch(() => null);
  if (!row || row.expiresAt < new Date()) throw invalid();
  if (row.clientId !== input.clientId) throw invalid();
  if (input.redirectUri ? input.redirectUri !== row.redirectUri : (await db.oAuthClient.count({ where: { id: row.clientId, redirectUris: { equals: [row.redirectUri] } } })) === 0) throw invalid();
  if (!verifierMatches(input.verifier, row.codeChallenge)) throw new OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge.");
  if (await suspended(row.userId)) throw new OAuthError("invalid_grant", "This account is suspended.");
  const t = freshTokens();
  await db.oAuthGrant.deleteMany({ where: { refreshExpiresAt: { lt: new Date() } } });
  await db.oAuthGrant.create({ data: { clientId: row.clientId, userId: row.userId, scope: row.scope, device: input.device?.trim().slice(0, 60) || null, ...t.data } });
  return response(t, row.scope);
}

export async function refresh(input: { refreshToken: string; clientId: string }): Promise<TokenResponse> {
  const invalid = () => new OAuthError("invalid_grant", "Signed out: sign in again.");
  if (!input.refreshToken) throw new OAuthError("invalid_request", "refresh_token is required.");
  const hash = hashToken(input.refreshToken);
  const grant = await db.oAuthGrant.findUnique({ where: { refreshHash: hash } });
  if (!grant) {
    // An old one coming back after the grace period: someone else has a
    // copy. End the whole sign-in, so neither copy works.
    const replaced = await db.oAuthGrant.findUnique({ where: { previousRefresh: hash } });
    if (replaced && (!replaced.rotatedAt || replaced.rotatedAt < seconds(-REUSE_GRACE_S))) await db.oAuthGrant.delete({ where: { id: replaced.id } }).catch(() => {});
    throw invalid();
  }
  if (grant.clientId !== input.clientId || grant.refreshExpiresAt < new Date()) throw invalid();
  if (await suspended(grant.userId)) throw new OAuthError("invalid_grant", "This account is suspended.");
  const t = freshTokens();
  // Only if nobody swapped it first.
  const { count } = await db.oAuthGrant.updateMany({ where: { id: grant.id, refreshHash: hash }, data: { ...t.data, previousRefresh: hash, rotatedAt: new Date(), lastUsedAt: new Date() } });
  if (!count) throw invalid();
  return response(t, grant.scope);
}

// RFC 7009: either kind of token ends the app's sign-in. Unknown tokens are
// fine (they're already as revoked as they get).
export async function revoke(token: string, clientId?: string) {
  if (!token) return;
  const hash = hashToken(token);
  await db.oAuthGrant.deleteMany({ where: { OR: [{ accessHash: hash }, { refreshHash: hash }], ...(clientId && { clientId }) } });
}

// --- Using a token ---

const TOUCH_EVERY_MS = 5 * 60_000;

// The account an access token is for, or null if it isn't (any more).
export async function authenticate(accessToken: string) {
  const grant = await db.oAuthGrant.findUnique({
    where: { accessHash: hashToken(accessToken) },
    include: { client: { select: { id: true, name: true } }, user: true },
  });
  if (!grant || grant.accessExpiresAt < new Date() || grant.user.suspended) return null;
  if (Date.now() - grant.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void db.oAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return { grant, user: grant.user };
}

// --- Connected apps, for Settings ---

export async function listGrants(userId: string) {
  const grants = await db.oAuthGrant.findMany({
    where: { userId, refreshExpiresAt: { gt: new Date() } },
    include: { client: { select: { name: true, uri: true } } },
    orderBy: { lastUsedAt: "desc" },
  });
  return grants.map((g) => ({ id: g.id, app: g.client.name, appUri: g.client.uri, device: g.device, createdAt: g.createdAt, lastUsedAt: g.lastUsedAt }));
}

export async function deleteGrant(userId: string, id: string) {
  const { count } = await db.oAuthGrant.deleteMany({ where: { id, userId } });
  return count > 0;
}

// Signing someone out everywhere (an admin, or suspending them) includes apps.
export async function revokeAllFor(userId: string) {
  await db.oAuthGrant.deleteMany({ where: { userId } });
  await db.oAuthCode.deleteMany({ where: { userId } });
}
