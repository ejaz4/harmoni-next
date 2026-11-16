import { createHash, randomBytes } from "node:crypto";

// The parts of Harmoni's OAuth that are pure rules: what an app may use as
// its redirect, PKCE, token formats. Kept apart so they're easy to test.

export const SCOPE = "harmoni"; // everything the web app can do, but server settings
// Asked for and quietly accepted: some OAuth libraries add these themselves.
const TOLERATED_SCOPES = new Set([SCOPE, "offline_access"]);

export const ACCESS_TTL_S = 60 * 60; // an hour
export const REFRESH_TTL_S = 90 * 24 * 60 * 60; // 90 days, renewed on every refresh
export const CODE_TTL_S = 5 * 60;
// Two refreshes racing (a retried request) shouldn't sign the app out: an
// old refresh token seen this soon after it was swapped is just refused.
export const REUSE_GRACE_S = 60;

// Opaque, random, and prefixed so a leaked one is recognisable in logs or
// secret scanners. Only their hashes are stored.
export const newToken = (prefix: "hat" | "hrt" | "hac") => `${prefix}_${randomBytes(32).toString("base64url")}`;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");
export const newClientId = () => `hcl_${randomBytes(16).toString("base64url")}`;

// PKCE (RFC 7636), S256 only: "plain" protects nothing.
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export const validChallenge = (challenge: string) => CHALLENGE.test(challenge);
export function verifierMatches(verifier: string, challenge: string): boolean {
  return VERIFIER.test(verifier) && createHash("sha256").update(verifier).digest("base64url") === challenge;
}

// Every scope asked for must be one Harmoni knows. Returns what's granted.
export function grantScope(requested: string | null | undefined): string | null {
  const asked = (requested ?? "").split(" ").filter(Boolean);
  return asked.every((s) => TOLERATED_SCOPES.has(s)) ? SCOPE : null;
}

// Schemes that would run something or go nowhere useful, never an app's.
const NOT_APP_SCHEMES = new Set(["javascript", "data", "vbscript", "file", "about", "blob", "filesystem", "ftp", "ws", "wss", "mailto", "tel", "sms", "intent"]);
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);

// Where an app may be sent back to (RFC 8252): its own private-use scheme
// (`com.example.app:/callback`), an https link it owns (Android App Links),
// or a loopback port on the device itself (desktop apps).
export function redirectProblem(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri || uri.length > 512) return "Redirect URIs must be strings of up to 512 characters.";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `${uri} isn't a URI.`;
  }
  if (url.hash || uri.includes("#")) return "Redirect URIs can't have a fragment.";
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "https") return url.hostname ? null : `${uri} has no host.`;
  if (scheme === "http") return LOOPBACK.has(url.hostname) ? null : "Plain http redirects are only allowed to the device itself (127.0.0.1 or [::1]).";
  if (NOT_APP_SCHEMES.has(scheme)) return `${scheme}: can't be a redirect.`;
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) ? null : `${scheme}: isn't a valid scheme.`;
}

// Whether `uri` is one the app registered. Exact, except that a loopback
// redirect may use any port, since a desktop app gets one when it starts.
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (asked.protocol !== "http:" || !LOOPBACK.has(asked.hostname)) return false;
  return registered.some((r) => {
    try {
      const reg = new URL(r);
      return reg.protocol === "http:" && reg.hostname === asked.hostname && reg.pathname === asked.pathname && reg.search === asked.search;
    } catch {
      return false;
    }
  });
}

// For the consent screen: where the app will be sent, said plainly.
export function describeRedirect(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:" || url.protocol === "http:") return url.host;
    return url.protocol.slice(0, -1);
  } catch {
    return uri;
  }
}

// Appends the authorization response (or error) to the redirect.
export function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}
