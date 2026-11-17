// This server's address as the person reached it: behind Caddy that's in the
// forwarded headers. Null if they don't add up, so the result is always safe
// to put in a URL or in HTML.

const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

export function originFrom(headers: Headers, fallback?: URL): string | null {
  const host = headers.get("x-forwarded-host")?.split(",")[0].trim() || headers.get("host") || fallback?.host;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0].trim() || fallback?.protocol.slice(0, -1) || "http";
  if (!host || !HOST.test(host) || (proto !== "http" && proto !== "https")) return null;
  return `${proto}://${host}`;
}
