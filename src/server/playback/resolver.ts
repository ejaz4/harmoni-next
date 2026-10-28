import type { SongSource } from "@/generated/prisma/client";
import { db } from "../db";
import { ProviderError, withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import { persistQueue } from "../search/persist-queue";
import { lookup, writeThrough, type CacheEntry } from "./cache";
import { crossmatch } from "./crossmatch";
import { isBenched, recordFailure, recordSuccess } from "./health";

const RESOLVE_DEADLINE_MS = 20_000;

export type Playback =
  | { kind: "cached"; songId: string; entry: CacheEntry }
  | { kind: "stream"; songId: string; body: ReadableStream<Uint8Array>; mimeType: string; contentLength?: number; source: string };

export class PlaybackError extends Error {
  constructor(
    readonly kind: "NotFound" | "Unavailable",
    message: string,
    readonly attempts: string[] = [],
  ) {
    super(message);
  }
}

// Cache first, then each playable source in ranked order, then a crossmatch
// for more sources. Fails only when all of that comes up empty.
export async function resolvePlayback(requestedId: string): Promise<Playback> {
  const songId = await persistQueue.settled(requestedId); // a fresh search may still be saving it

  const entry = await lookup(songId);
  if (entry) return { kind: "cached", songId, entry };

  const song = await db.song.findUnique({
    where: { id: songId },
    include: { sources: true, artists: { include: { artist: true }, orderBy: { position: "asc" } } },
  });
  if (!song) throw new PlaybackError("NotFound", `No song ${songId}`);

  const attempts: string[] = [];
  const tried = new Set<string>();
  const attempt = async (sources: SongSource[]) => {
    for (const source of rank(sources.filter((s) => !tried.has(s.id)))) {
      tried.add(source.id);
      const result = await tryStream(songId, source, attempts);
      if (result) return result;
    }
  };

  const first = await attempt(song.sources);
  if (first) return first;

  const linked = await crossmatch({
    id: song.id,
    title: song.title,
    artists: song.artists.map((a) => a.artist.name),
    durationMs: song.durationMs ?? undefined,
    isrc: song.isrc ?? undefined,
    linked: new Set(song.sources.map((s) => `${s.provider}:${s.externalId}`)),
  });
  if (linked) {
    const fresh = await db.songSource.findMany({ where: { songId } });
    const second = await attempt(fresh);
    if (second) return second;
  }

  throw new PlaybackError("Unavailable", `No playable source for "${song.title}"`, attempts);
}

// Playable sources only: preferred providers first (PROVIDER_ORDER, else
// registry order), then the healthiest source within each provider.
function rank(sources: SongSource[]): SongSource[] {
  const registry = getRegistry();
  const order = (process.env.PROVIDER_ORDER?.split(",").map((s) => s.trim()) ?? []).concat(
    registry.withRole("song").map((p) => p.prefix),
  );
  const position = (s: SongSource) => order.indexOf(s.provider);
  return sources
    .filter((s) => registry.has(s.provider, "song") && !isBenched(s.provider))
    .sort(
      (a, b) =>
        position(a) - position(b) ||
        a.failCount - b.failCount ||
        (b.lastOkAt?.getTime() ?? 0) - (a.lastOkAt?.getTime() ?? 0),
    );
}

async function tryStream(songId: string, source: SongSource, attempts: string[]): Promise<Playback | undefined> {
  const provider = getRegistry().get(source.provider)!.song!;
  const uri = `${source.provider}:${source.externalId}`;
  try {
    const audio = await withDeadline(provider.resolveStream(source.externalId), RESOLVE_DEADLINE_MS, source.provider);
    recordSuccess(source.provider);
    await db.songSource.update({ where: { id: source.id }, data: { failCount: 0, lastOkAt: new Date() } });
    attempts.push(`${uri}: ok`);
    const body = provider.cacheable === false ? audio.body : writeThrough(songId, audio, uri);
    return { kind: "stream", songId, body, mimeType: audio.mimeType, contentLength: audio.contentLength, source: uri };
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : "Unknown";
    console.warn(`playback: ${uri} failed (${kind})`, err);
    recordFailure(source.provider, kind);
    await db.songSource.update({
      where: { id: source.id },
      data: { failCount: { increment: 1 }, lastFailAt: new Date() },
    });
    attempts.push(`${uri}: ${kind}`);
    return undefined;
  }
}
