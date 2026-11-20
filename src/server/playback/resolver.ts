import type { SongSource } from "@/generated/prisma/client";
import { db } from "../db";
import { ProviderError, withDeadline, type ProviderErrorKind } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { ProviderPlugin } from "../providers/types";
import { persistQueue } from "../search/persist-queue";
import { serverSettingsNow } from "../settings";
import { lookup, writeThrough, type CacheEntry } from "./cache";
import { crossmatch } from "./crossmatch";
import { isBenched, recordFailure, recordSuccess } from "./health";

// Room for YouTube's pre-roll ad wait (see ytm.ts), or a whole yt-dlp download.
const RESOLVE_DEADLINE_MS = 30_000;

export type Playback =
  | { kind: "cached"; songId: string; entry: CacheEntry }
  | {
      kind: "stream";
      songId: string;
      body: ReadableStream<Uint8Array>;
      mimeType: string;
      start: number;
      totalLength?: number;
      source: string;
    };

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
// `start` is a byte offset when the player seeks before the song is cached.
export async function resolvePlayback(requestedId: string, start = 0): Promise<Playback> {
  const songId = await persistQueue.settled(requestedId); // a fresh search may still be saving it

  const entry = await lookup(songId);
  if (entry) return { kind: "cached", songId, entry };

  const song = await db.song.findUnique({
    where: { id: songId },
    include: { sources: true, album: true, artists: { include: { artist: true }, orderBy: { position: "asc" } } },
  });
  if (!song) throw new PlaybackError("NotFound", `No song ${songId}`);

  const attempts: string[] = [];
  const tried = new Set<string>();
  const attempt = async (sources: SongSource[]) => {
    for (const { source, players } of plan(sources.filter((s) => !tried.has(s.id)))) {
      tried.add(source.id);
      for (const player of players) {
        const result = await tryStream(songId, source, player, start, attempts);
        if (typeof result !== "string") return result;
        if (result === "NotFound") break; // gone from YouTube is gone for yt-dlp too
      }
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
    album: song.album?.title,
    linked: new Set(song.sources.map((s) => `${s.provider}:${s.externalId}`)),
  });
  if (linked) {
    const fresh = await db.songSource.findMany({ where: { songId } });
    const second = await attempt(fresh);
    if (second) return second;
  }

  throw new PlaybackError("Unavailable", `No playable source for "${song.title}"`, attempts);
}

// Each playable source with the providers that can play it (YouTube Music
// sources: YouTube Music's direct stream, then yt-dlp's download). Preferred
// providers first (Server settings, else registry order), then the healthiest
// source. A source gets every player before the next source is tried: when
// one way of fetching it fails, another usually works. Benched providers go
// last rather than not at all: a retry must really retry.
function plan(sources: SongSource[]): { source: SongSource; players: ProviderPlugin[] }[] {
  const registry = getRegistry();
  const order = serverSettingsNow().songOrder.concat(
    registry.withRole("song").map((p) => p.prefix),
  );
  const rank = (p: ProviderPlugin) => Number(isBenched(p.prefix)) * order.length + order.indexOf(p.prefix);
  return sources
    .map((source) => ({ source, players: registry.playersFor(source.provider).sort((a, b) => rank(a) - rank(b)) }))
    .filter((x) => x.players.length > 0)
    .sort(
      (a, b) =>
        rank(a.players[0]) - rank(b.players[0]) ||
        a.source.failCount - b.source.failCount ||
        (b.source.lastOkAt?.getTime() ?? 0) - (a.source.lastOkAt?.getTime() ?? 0),
    );
}

// The playback, or why it failed.
async function tryStream(
  songId: string,
  source: SongSource,
  player: ProviderPlugin,
  start: number,
  attempts: string[],
): Promise<Playback | ProviderErrorKind | "Unknown"> {
  const provider = player.song!;
  const uri = `${source.provider}:${source.externalId}${player.prefix === source.provider ? "" : ` via ${player.prefix}`}`;
  try {
    const audio = await withDeadline(provider.resolveStream(source.externalId, start), RESOLVE_DEADLINE_MS, player.prefix);
    recordSuccess(player.prefix);
    await db.songSource.update({ where: { id: source.id }, data: { failCount: 0, lastOkAt: new Date() } });
    attempts.push(`${uri}: ok`);
    // Seeks fetch a partial stream; the play from byte 0 is the one that caches.
    const cache = provider.cacheable !== false && audio.start === 0;
    return {
      kind: "stream",
      songId,
      body: cache ? writeThrough(songId, audio, uri) : audio.body,
      mimeType: audio.mimeType,
      start: audio.start,
      totalLength: audio.totalLength,
      source: uri,
    };
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : "Unknown";
    console.warn(`playback: ${uri} failed (${kind})`, err);
    recordFailure(player.prefix, kind, songId);
    await db.songSource.update({
      where: { id: source.id },
      data: { failCount: { increment: 1 }, lastFailAt: new Date() },
    });
    attempts.push(`${uri}: ${kind}`);
    return kind;
  }
}
