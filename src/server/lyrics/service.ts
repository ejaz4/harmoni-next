import type { Lyrics as LyricsRow, Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { LyricsQuery, ProviderPlugin } from "../providers/types";
import { persistQueue } from "../search/persist-queue";
import { serverSettingsNow } from "../settings";
import { detectLanguage, romanizeLines } from "./romanize";
import type { Lyrics, LyricLine, LyricsSync } from "./types";

// Room for LRCLIB to back off and retry when it says it's busy.
const PROVIDER_DEADLINE_MS = 12_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
// How long a cached result is trusted before a background recheck. Better
// results turn up over time: corrections, plain text gaining timing, songs
// that had none getting lyrics.
const REFRESH = {
  synced: 30 * DAY,
  plain: 1 * DAY,
  missing: 3 * DAY,
  // A provider errored, so what we have may be second best; look again soon.
  degraded: 1 * HOUR,
};
export interface LyricsResponse {
  songId: string;
  found: boolean;
  provider?: string;
  sync?: LyricsSync;
  language?: string;
  instrumental?: boolean;
  lines: LyricLine[];
}

// Songs being rechecked right now, so a busy song isn't fetched twice at once.
const refreshing = new Set<string>();

// Cached lyrics are returned straight away, even when due for a recheck: the
// recheck happens in the background and the next request sees anything
// better. Only a song never looked up before waits on the providers.
// Returns null for an unknown song.
export async function getSongLyrics(requestedId: string): Promise<LyricsResponse | null> {
  const songId = await persistQueue.settled(requestedId);
  const cached = await db.lyrics.findUnique({ where: { songId } });
  if (cached) {
    if (!cached.refreshAfter || cached.refreshAfter <= new Date()) refreshInBackground(songId, cached);
    return fromRow(songId, cached);
  }
  return lookUp(songId, undefined);
}

function refreshInBackground(songId: string, cached: LyricsRow) {
  if (refreshing.has(songId)) return;
  refreshing.add(songId);
  lookUp(songId, cached)
    .catch((err) => console.warn(`lyrics: background refresh of ${songId} failed`, err))
    .finally(() => refreshing.delete(songId));
}

// Fetches from the providers and stores the result, unless it's worse than
// what's cached (a provider being down mustn't replace synced lyrics with
// plain text or nothing). Returns what's now cached.
async function lookUp(songId: string, cached: LyricsRow | undefined): Promise<LyricsResponse | null> {
  const song = await db.song.findUnique({
    where: { id: songId },
    include: { artists: { include: { artist: true }, orderBy: { position: "asc" } }, album: true, sources: true },
  });
  if (!song) return null;

  const { result, degraded } = await fetchLyrics({
    title: song.title,
    artists: song.artists.map((a) => a.artist.name),
    album: song.album?.title,
    durationMs: song.durationMs ?? undefined,
    isrc: song.isrc ?? undefined,
    sources: song.sources.map((s) => ({ provider: s.provider, externalId: s.externalId })),
  });

  if (cached && quality(result?.lyrics) < quality(cached)) {
    // Keep what we have; try again later (soon, if a provider was down).
    const refreshAfter = new Date(Date.now() + (degraded ? REFRESH.degraded : refreshDelay(cached)));
    await db.lyrics.update({ where: { songId }, data: { refreshAfter } });
    return fromRow(songId, cached);
  }

  if (!result) {
    const refreshAfter = new Date(Date.now() + (degraded ? REFRESH.degraded : REFRESH.missing));
    const row = { found: false, provider: null, sync: null, lines: [], language: null, refreshAfter, fetchedAt: new Date() };
    await db.lyrics.upsert({ where: { songId }, create: { songId, ...row }, update: row });
    return { songId, found: false, lines: [] };
  }

  const { provider, lyrics } = result;
  const language = detectLanguage(lyrics.lines);
  if (language) {
    try {
      await romanizeLines(lyrics.lines, language);
    } catch (err) {
      console.warn(`lyrics: romanising ${songId} failed`, err);
    }
  }
  const synced = lyrics.sync !== "none" || lyrics.instrumental;
  const row = {
    found: true,
    provider,
    sync: lyrics.sync,
    lines: lyrics.lines as unknown as Prisma.InputJsonValue,
    language: language ?? null,
    refreshAfter: new Date(Date.now() + (synced ? REFRESH.synced : degraded ? REFRESH.degraded : REFRESH.plain)),
    fetchedAt: new Date(),
  };
  await db.lyrics.upsert({ where: { songId }, create: { songId, ...row }, update: row });
  return { songId, found: true, provider, sync: lyrics.sync, language, instrumental: lyrics.instrumental, lines: lyrics.lines };
}

// 2 = synced or instrumental, 1 = plain text, 0 = nothing.
function quality(lyrics: Lyrics | LyricsRow | undefined): number {
  if (!lyrics) return 0;
  if ("found" in lyrics) {
    if (!lyrics.found) return 0;
    const empty = !(lyrics.lines as unknown[] | null)?.length;
    return lyrics.sync !== "none" || empty ? 2 : 1;
  }
  return lyrics.sync !== "none" || lyrics.instrumental ? 2 : 1;
}

function refreshDelay(row: LyricsRow): number {
  const q = quality(row);
  return q === 2 ? REFRESH.synced : q === 1 ? REFRESH.plain : REFRESH.missing;
}

function fromRow(songId: string, row: LyricsRow): LyricsResponse {
  const lines = (row.lines as unknown as LyricLine[] | null) ?? [];
  return {
    songId,
    found: row.found,
    provider: row.provider ?? undefined,
    sync: (row.sync as LyricsSync | null) ?? undefined,
    language: row.language ?? undefined,
    instrumental: row.found && row.sync === "none" && !lines.length,
    lines,
  };
}

// `degraded` means a provider errored, so a better result may exist.
async function fetchLyrics(query: LyricsQuery): Promise<{ result?: { provider: string; lyrics: Lyrics }; degraded: boolean }> {
  let fallback: { provider: string; lyrics: Lyrics } | undefined;
  let degraded = false;
  for (const p of orderedProviders()) {
    try {
      const lyrics = await withDeadline(p.lyrics!.getLyrics(query), PROVIDER_DEADLINE_MS, p.prefix);
      if (!lyrics || (!lyrics.lines.length && !lyrics.instrumental)) continue;
      if (lyrics.sync !== "none" || lyrics.instrumental) return { result: { provider: p.prefix, lyrics }, degraded };
      fallback ??= { provider: p.prefix, lyrics };
    } catch (err) {
      degraded = true;
      console.warn(`lyrics: ${p.prefix} failed for "${query.title}"`, err);
    }
  }
  return { result: fallback, degraded };
}

function orderedProviders(): ProviderPlugin[] {
  const order = serverSettingsNow().lyricsOrder;
  const rank = (p: ProviderPlugin) => (order.includes(p.prefix) ? order.indexOf(p.prefix) : order.length);
  return getRegistry()
    .withRole("lyrics")
    .sort((a, b) => rank(a) - rank(b));
}
