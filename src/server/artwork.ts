import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Every cover and artist photo Harmoni hands out goes through its own
// server: /api/art/<signature>/<url>. Clients never talk to a third-party
// CDN (no tracking, no hotlink blocks, same-origin pixels for colours), and
// each image is fetched once, resized and kept on disk.
//
// The path carries the original URL and an HMAC of it, so the endpoint only
// fetches URLs this server put out, never any URL someone asks for. That
// also means it needs no sign-in: apps load these like any image.

const SECRET = process.env.BETTER_AUTH_SECRET || "harmoni-dev-artwork";
const CACHE_DIR = path.resolve(process.env.CACHE_DIR ?? "./data/cache", "art");
const PREFIX = "/api/art/";

// The widths it'll resize to. Anything else is served at the nearest, so
// there's a small, fixed number of copies per image.
export const ART_SIZES = [64, 128, 256, 512, 1024] as const;
const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const sign = (url: string) => createHmac("sha256", SECRET).update(url).digest("base64url").slice(0, 22);

// Where artwork links point: this server's public address, so a client can
// load them as they are (the phone app hands them straight to its image
// loader). Taken from config, never from a request's headers, which anyone
// can set.
function publicOrigin(): string {
  try {
    return new URL(process.env.BETTER_AUTH_URL ?? "").origin;
  } catch {
    return "";
  }
}

// The proxied URL for an image URL. Our own paths (uploads) and URLs that
// are already proxied pass through untouched, so it's safe to apply twice.
export function artUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return url;
  if (!/^https?:\/\//i.test(url)) return undefined;
  const origin = publicOrigin();
  if (url.startsWith(`${origin}${PREFIX}`)) return url;
  return `${origin}${PREFIX}${sign(url)}/${Buffer.from(url).toString("base64url")}`;
}

export function artUrls(urls: (string | null | undefined)[]): string[] {
  return urls.flatMap((u) => artUrl(u) ?? []);
}

// The original URL behind a proxied path's parts, if the signature is ours.
export function verifyArt(signature: string, token: string): string | undefined {
  let url: string;
  try {
    url = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  if (!/^https?:\/\//i.test(url)) return undefined;
  const expected = Buffer.from(sign(url));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? url : undefined;
}

export function nearestSize(width: number | undefined): number | undefined {
  if (!width || !Number.isFinite(width)) return undefined;
  return ART_SIZES.find((s) => s >= width) ?? ART_SIZES.at(-1);
}

export interface ArtImage {
  body: Buffer;
  type: string;
}

const inflight = new Map<string, Promise<ArtImage | undefined>>();

// The image, from disk if we've had it before, else fetched (and resized to
// `width`, as WebP) and kept.
export function getArt(url: string, width?: number): Promise<ArtImage | undefined> {
  const key = createHash("sha256").update(`${url}\n${width ?? "full"}`).digest("hex");
  let pending = inflight.get(key);
  if (!pending) {
    pending = load(key, url, width).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

async function load(key: string, url: string, width?: number): Promise<ArtImage | undefined> {
  const dir = path.join(CACHE_DIR, key.slice(0, 2));
  const file = path.join(dir, key);
  try {
    const [body, type] = await Promise.all([readFile(file), readFile(`${file}.type`, "utf8")]);
    return { body, type };
  } catch {}

  const original = await fetchImage(url);
  if (!original) return undefined;
  let image = original;
  if (width) {
    try {
      const body = await sharp(original.body, { failOn: "none" })
        .rotate()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      image = { body, type: "image/webp" };
    } catch {
      // Not something sharp can read: serve it as it came.
    }
  }
  try {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}`;
    await writeFile(`${file}.type`, image.type);
    await writeFile(tmp, image.body);
    await rename(tmp, file);
  } catch (err) {
    console.warn("art: couldn't cache", err);
  }
  return image;
}

async function fetchImage(url: string): Promise<ArtImage | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    // Raster images only: an SVG from our origin could carry script.
    if (!res.ok || !type.startsWith("image/") || type.includes("svg")) return undefined;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return undefined;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return undefined;
    return { body, type };
  } catch {
    return undefined;
  }
}
