import { OAuthError } from ".";

// HTTP plumbing shared by the OAuth endpoints.

// This server as the app reached it (behind Caddy, from the forwarded
// headers), so the URLs in discovery always point back the same way.
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.slice(0, -1);
  return `${proto}://${host}`;
}

// Token and revocation requests are form-encoded by the spec; JSON is taken too.
export async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  try {
    if (type.includes("application/json")) {
      for (const [k, v] of Object.entries((await request.json()) as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    } else {
      for (const [k, v] of new URLSearchParams(await request.text())) out[k] = v;
    }
  } catch {}
  // A public client may also name itself in HTTP Basic auth, with no secret.
  const basic = request.headers.get("authorization")?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (basic && !out.client_id) {
    try {
      out.client_id = decodeURIComponent(atob(basic).split(":")[0]);
    } catch {}
  }
  return out;
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const oauthJson = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

// RFC 6749 §5.2 error bodies. Anything unexpected is logged, not shown.
export function oauthFailure(err: unknown): Response {
  if (err instanceof OAuthError) return oauthJson({ error: err.code, error_description: err.message }, err.status);
  console.error("oauth:", err);
  return oauthJson({ error: "server_error", error_description: "Something went wrong on the server." }, 500);
}
