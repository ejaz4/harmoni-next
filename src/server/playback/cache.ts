import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import type { AudioStream } from "../providers/types";
import { getServerSettings } from "../settings";

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
    const { meta } = paths(songId);
    const entry = JSON.parse(await readFile(meta, "utf8")) as CacheEntry;
    const { size } = await stat(entry.file);
    if (size !== entry.size) return undefined;
    // The note's time is when it was last played: trimming goes oldest first.
    const now = new Date();
    void utimes(meta, now, now).catch(() => {});
    return entry;
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
    trimSoon();
  } catch (err) {
    console.warn(`cache: not storing ${songId}`, err);
    await rm(partial, { force: true });
  }
}

// --- For Server settings: how big it is, a limit, and emptying it ---

interface Stored {
  meta: string;
  file?: string;
  size: number;
  playedAt: number;
}

async function stored(): Promise<Stored[]> {
  let names: string[];
  try {
    names = await readdir(CACHE_DIR);
  } catch {
    return []; // nothing cached yet
  }
  const songs = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map(async (n): Promise<Stored | undefined> => {
        const meta = path.join(CACHE_DIR, n);
        try {
          const [entry, info] = await Promise.all([readFile(meta, "utf8").then((t) => JSON.parse(t) as CacheEntry), stat(meta)]);
          return { meta, file: entry.file, size: entry.size, playedAt: info.mtimeMs };
        } catch {
          return undefined;
        }
      }),
  );
  return songs.filter((s): s is Stored => !!s);
}

export async function cacheUsage(): Promise<{ songs: number; bytes: number }> {
  const songs = await stored();
  return { songs: songs.length, bytes: songs.reduce((sum, s) => sum + s.size, 0) };
}

async function remove(songs: Stored[]) {
  for (const s of songs) {
    // The note first, so a half-removed song reads as not cached.
    await rm(s.meta, { force: true });
    if (s.file) await rm(s.file, { force: true });
  }
}

export async function clearCache(): Promise<number> {
  const songs = await stored();
  await remove(songs);
  return songs.length;
}

// Removes the songs played longest ago until the cache fits in `limitBytes`.
export async function trimCache(limitBytes: number): Promise<number> {
  if (!limitBytes) return 0;
  const songs = (await stored()).sort((a, b) => a.playedAt - b.playedAt);
  let total = songs.reduce((sum, s) => sum + s.size, 0);
  const out: Stored[] = [];
  for (const s of songs) {
    if (total <= limitBytes) break;
    out.push(s);
    total -= s.size;
  }
  await remove(out);
  if (out.length) console.info(`cache: trimmed ${out.length} songs to stay under ${(limitBytes / 1e9).toFixed(0)} GB`);
  return out.length;
}

// After songs land, at most once a minute.
let trimTimer: ReturnType<typeof setTimeout> | undefined;
function trimSoon() {
  trimTimer ??= setTimeout(async () => {
    trimTimer = undefined;
    const { cacheLimitGb } = await getServerSettings();
    await trimCache(cacheLimitGb * 1e9).catch((err) => console.warn("cache: trimming failed", err));
  }, 60_000);
}
