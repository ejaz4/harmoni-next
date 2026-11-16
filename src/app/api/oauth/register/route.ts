import { registerClient, type ClientMetadata } from "@/server/oauth";
import { oauthFailure, oauthJson } from "@/server/oauth/http";

// RFC 7591: an app registers itself the first time it meets this server and
// gets a client_id back. Public, so it's rate limited per address.

const WINDOW_MS = 60 * 60_000;
const PER_WINDOW = 20;
const globalForRegister = globalThis as unknown as { oauthRegistrations?: Map<string, number[]> };
const recent = (globalForRegister.oauthRegistrations ??= new Map<string, number[]>());

function tooMany(request: Request): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const times = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) return true;
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 10_000) recent.clear();
  return false;
}

export async function POST(request: Request) {
  if (tooMany(request)) return oauthJson({ error: "slow_down", error_description: "Too many apps registered from here. Try again in an hour." }, 429);
  let meta: ClientMetadata;
  try {
    meta = (await request.json()) as ClientMetadata;
  } catch {
    return oauthJson({ error: "invalid_client_metadata", error_description: "Send the app's metadata as JSON." }, 400);
  }
  try {
    return oauthJson(await registerClient(meta ?? {}), 201);
  } catch (err) {
    return oauthFailure(err);
  }
}
