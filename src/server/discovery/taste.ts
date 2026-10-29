import { db } from "../db";
import { currentAffinity, isDisliked, songAffinity } from "./score";

// Someone's taste, as numbers: how much they like each song they've come
// across and each artist behind them. A few indexed queries, no history
// scans; kept for a couple of minutes since autoplay asks often.

const MAX_SONGS = 4000; // most recent; older ones barely move the scores
const CACHE_MS = 2 * 60_000;

export interface Taste {
  songs: Map<string, number>; // affinity per song
  current: Map<string, number>; // affinity weighted towards lately
  artists: Map<string, number>; // summed from their songs
  songArtists: Map<string, string[]>; // song → artist ids, lead first
  lastHeard: Map<string, number>; // song → ms timestamp
  disliked: Set<string>;
}

const cache = new Map<string, { at: number; taste: Promise<Taste> }>();

export function loadTaste(userId: string): Promise<Taste> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.taste;
  const taste = computeTaste(userId);
  cache.set(userId, { at: Date.now(), taste });
  taste.catch(() => cache.delete(userId));
  return taste;
}

export function forgetTaste(userId: string) {
  cache.delete(userId);
}

async function computeTaste(userId: string): Promise<Taste> {
  const [stats, likes, inPlaylists] = await Promise.all([
    db.songStat.findMany({
      where: { userId },
      orderBy: { lastAt: "desc" },
      take: MAX_SONGS,
      select: { songId: true, listens: true, completes: true, skips: true, earlySkips: true, replays: true, lastAt: true },
    }),
    db.like.findMany({ where: { userId }, select: { songId: true, createdAt: true } }),
    db.playlistItem.groupBy({ by: ["songId"], where: { playlist: { ownerId: userId } }, _count: { _all: true } }),
  ]);

  const statById = new Map(stats.map((s) => [s.songId, s]));
  const likedAt = new Map(likes.map((l) => [l.songId, l.createdAt]));
  const playlistCount = new Map(inPlaylists.map((p) => [p.songId, p._count._all]));
  const ids = [...new Set([...statById.keys(), ...likedAt.keys(), ...playlistCount.keys()])];

  const credits = await db.songArtist.findMany({
    where: { songId: { in: ids } },
    select: { songId: true, artistId: true, role: true, position: true },
    orderBy: { position: "asc" },
  });

  const now = Date.now();
  const taste: Taste = { songs: new Map(), current: new Map(), artists: new Map(), songArtists: new Map(), lastHeard: new Map(), disliked: new Set() };
  for (const id of ids) {
    const stat = statById.get(id);
    const lib = { liked: likedAt.has(id), playlists: playlistCount.get(id) ?? 0 };
    const score = songAffinity(stat, lib, now);
    taste.songs.set(id, score);
    // A liked song nobody's played since counts as of when it was liked.
    const lastAt = stat?.lastAt ?? likedAt.get(id) ?? new Date(0);
    taste.current.set(id, currentAffinity(score, lastAt, now));
    if (stat) taste.lastHeard.set(id, stat.lastAt.getTime());
    if (isDisliked(stat, lib)) taste.disliked.add(id);
  }
  for (const c of credits) {
    const list = taste.songArtists.get(c.songId) ?? [];
    list.push(c.artistId);
    taste.songArtists.set(c.songId, list);
    const score = taste.songs.get(c.songId) ?? 0;
    // Featured credits count for less; dislikes count for less than likes,
    // so one skipped song doesn't sink an artist.
    const weight = (c.role === "primary" ? 1 : 0.4) * (score < 0 ? 0.5 : 1);
    taste.artists.set(c.artistId, (taste.artists.get(c.artistId) ?? 0) + score * weight);
  }
  return taste;
}

// Ranks by a score map, highest first.
export function top<K>(scores: Map<K, number>, n: number, keep: (key: K, score: number) => boolean = () => true): K[] {
  return [...scores]
    .filter(([k, s]) => keep(k, s))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}
