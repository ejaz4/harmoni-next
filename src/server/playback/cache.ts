import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import type { AudioStream } from "../providers/types";

// Audio cache, keyed by canonical song id. Once a song is here, playing it
// never touches a provider again.
const CACHE_DIR = path.resolve(process.env.CACHE_DIR ?? "./data/cache", "audio");
const SONG_ID = /^[0-9a-f-]{36}$/;

export interface CacheEntry {
  file: string;
  mimeType: string;
  size: number;
  source: string; // which provider source it came from
  cachedAt: string;
}

function paths(songId: string, ext = "bin") {
  if (!SONG_ID.test(songId)) throw new Error(`Invalid song id: ${songId}`);
  return { meta: path.join(CACHE_DIR, `${songId}.json`), file: path.join(CACHE_DIR, `${songId}.${ext}`) };
}

export async function lookup(songId: string): Promise<CacheEntry | undefined> {
  try {
    const entry = JSON.parse(await readFile(paths(songId).meta, "utf8")) as CacheEntry;
    const { size } = await stat(entry.file);
    return size === entry.size ? entry : undefined;
  } catch {
    return undefined;
  }
}

// Splits the stream: one branch for the listener, one written to disk.
// The file only lands once the whole song has arrived intact. The disk
// branch keeps going if the listener disconnects (e.g. seeks), so the
// song still finishes caching. Only pass streams that start at byte 0.
export function writeThrough(songId: string, audio: AudioStream, source: string): ReadableStream<Uint8Array> {
  const [toListener, toDisk] = audio.body.tee();
  void save(songId, toDisk, audio, source);
  return toListener;
}

async function save(songId: string, body: ReadableStream<Uint8Array>, audio: AudioStream, source: string) {
  const { meta, file } = paths(songId, audio.ext);
  const partial = `${file}.${randomUUID()}.part`;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await body.pipeTo(Writable.toWeb(createWriteStream(partial)) as WritableStream<Uint8Array>);
    const { size } = await stat(partial);
    if (audio.totalLength !== undefined && size !== audio.totalLength) {
      throw new Error(`got ${size} of ${audio.totalLength} bytes`);
    }
    await rename(partial, file);
    const entry: CacheEntry = { file, mimeType: audio.mimeType, size, source, cachedAt: new Date().toISOString() };
    await writeFile(meta, JSON.stringify(entry));
    console.info(`cache: stored ${songId} (${(size / 1e6).toFixed(1)} MB from ${source})`);
  } catch (err) {
    console.warn(`cache: not storing ${songId}`, err);
    await rm(partial, { force: true });
  }
}
