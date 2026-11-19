import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BadRequest } from "../library/service";

// Pictures people put on their profiles, kept next to the audio cache (on
// the same volume) but apart from it, so clearing the cache keeps them.
// Each is re-encoded at a fixed size: nothing uploaded is served as sent.

const MEDIA_DIR = path.resolve(process.env.CACHE_DIR ?? "./data/cache", "..", "media");
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const KEY = /^[a-z0-9]{24}\.webp$/;

const SIZES = {
  avatar: { width: 512, height: 512 },
  banner: { width: 1800, height: 600 },
} as const;

export type MediaKind = keyof typeof SIZES;

export class BadImage extends BadRequest {}

export async function saveImage(kind: MediaKind, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new BadImage("That picture is too big: 10 MB at most.");
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: 80_000_000 })
      .rotate() // as the camera held it
      .resize({ ...SIZES[kind], fit: "cover", position: "attention" })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw new BadImage("That doesn't look like a picture Harmoni can read. Try a JPEG, PNG, WebP or GIF.");
  }
  const key = `${randomBytes(12).toString("hex")}.webp`;
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, key), out);
  return key;
}

export async function readImage(key: string): Promise<Buffer | null> {
  if (!KEY.test(key)) return null;
  return readFile(path.join(MEDIA_DIR, key)).catch(() => null);
}

export async function deleteImage(key: string | null | undefined): Promise<void> {
  if (key && KEY.test(key)) await unlink(path.join(MEDIA_DIR, key)).catch(() => {});
}

export const mediaUrl = (key: string | null | undefined) => (key ? `/api/media/${key}` : undefined);
