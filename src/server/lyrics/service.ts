import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { LyricsQuery, ProviderPlugin } from "../providers/types";
import { persistQueue } from "../search/persist-queue";
import { detectLanguage, romanizeLines } from "./romanize";
import type { Lyrics, LyricLine, LyricsSync } from "./types";

const PROVIDER_DEADLINE_MS = 8000;
const MISS_RETRY_MS = 3 * 24 * 60 * 60_000; // lyrics get added to databases over time
// When a provider errored (rather than having nothing), what we got may be
// second best (plain text instead of synced), so look again soon.
const DEGRADED_RETRY_MS = 60 * 60_000;
// Synced sources first; YouTube Music only has plain text.
const DEFAULT_ORDER = ["lrclib", "ytm"];

export interface LyricsResponse {
  songId: string;
  found: boolean;
  provider?: string;
  sync?: LyricsSync;
  language?: string;
  instrumental?: boolean;
  lines: LyricLine[];
}

// Cached per song. Tries each lyrics provider in order and keeps the first
// synced result; plain text is the fallback. Returns null for an unknown song.
export async function getSongLyrics(requestedId: string): Promise<LyricsResponse | null> {
  const songId = await persistQueue.settled(requestedId);

  const cached = await db.lyrics.findUnique({ where: { songId } });
  // Rows with retryAfter are misses or degraded results, served only until then.
  if (cached && (!cached.retryAfter || cached.retryAfter > new Date())) {
    return {
      songId,
      found: cached.found,
      provider: cached.provider ?? undefined,
      sync: (cached.sync as LyricsSync | null) ?? undefined,
      language: cached.language ?? undefined,
      instrumental: cached.found && cached.sync === "none" && !(cached.lines as unknown[] | null)?.length,
      lines: (cached.lines as unknown as LyricLine[] | null) ?? [],
    };
  }

  const song = await db.song.findUnique({
    where: { id: songId },
    include: { artists: { include: { artist: true }, orderBy: { position: "asc" } }, album: true, sources: true },
  });
  if (!song) return null;

  const query: LyricsQuery = {
    title: song.title,
    artists: song.artists.map((a) => a.artist.name),
    album: song.album?.title,
    durationMs: song.durationMs ?? undefined,
    isrc: song.isrc ?? undefined,
    sources: song.sources.map((s) => ({ provider: s.provider, externalId: s.externalId })),
  };

  const { result: found, degraded } = await fetchLyrics(query);
  if (!found) {
    const retryAfter = new Date(Date.now() + (degraded ? DEGRADED_RETRY_MS : MISS_RETRY_MS));
    await db.lyrics.upsert({
      where: { songId },
      create: { songId, found: false, retryAfter },
      update: { found: false, provider: null, sync: null, lines: [], retryAfter, fetchedAt: new Date() },
    });
    return { songId, found: false, lines: [] };
  }

  const { provider, lyrics } = found;
  const language = detectLanguage(lyrics.lines);
  if (language) {
    try {
      await romanizeLines(lyrics.lines, language);
    } catch (err) {
      console.warn(`lyrics: romanising ${songId} failed`, err);
    }
  }
  const row = {
    found: true,
    provider,
    sync: lyrics.sync,
    lines: lyrics.lines as unknown as Prisma.InputJsonValue,
    language: language ?? null,
    retryAfter: degraded && lyrics.sync === "none" ? new Date(Date.now() + DEGRADED_RETRY_MS) : null,
    fetchedAt: new Date(),
  };
  await db.lyrics.upsert({ where: { songId }, create: { songId, ...row }, update: row });
  return { songId, found: true, provider, sync: lyrics.sync, language, instrumental: lyrics.instrumental, lines: lyrics.lines };
}

// `degraded` means a provider errored, so a better result may exist.
async function fetchLyrics(
  query: LyricsQuery,
): Promise<{ result?: { provider: string; lyrics: Lyrics }; degraded: boolean }> {
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
  const order = process.env.LYRICS_ORDER?.split(",").map((s) => s.trim()) ?? DEFAULT_ORDER;
  const rank = (p: ProviderPlugin) => (order.includes(p.prefix) ? order.indexOf(p.prefix) : order.length);
  return getRegistry()
    .withRole("lyrics")
    .sort((a, b) => rank(a) - rank(b));
}
