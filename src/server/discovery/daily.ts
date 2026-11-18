import { db } from "../db";
import { closeness, firstName, local, PARTS, type DayPart } from "@/lib/day-part";
import type { Taste } from "./taste";

export { dayPart, validTimeZone, type DayPart } from "@/lib/day-part";

// Someone's own Spice that follows the day: in the morning it's what they
// play in the mornings, at night what they play at night. Built from Super
// Processing's listens, each placed in the part of the day it happened in
// (their time zone), with one of the search Spices mixed in as a source
// and naming it: "Ejaz's Morning K-Pop Spice".

const DAY = 24 * 60 * 60_000;
const HISTORY_DAYS = 90;
const MAX_LISTENS = 6000;
const POOL_SIZE = 80;
const THIN = 6; // below this much listening in the part of the day, their usual favourites fill in

// --- The songs ---

export interface DailyPool {
  ids: string[]; // most typical of this part of the day first
  weights: Map<string, number>; // song → weight in this part of the day
  overall: Map<string, number>; // song → weight across the whole day, to tell what's typical
  leads: Map<string, string>; // song → lead artist id
}

// Each listen counts for how much of the song they heard, fading over
// months, and goes to the part of the day it happened in. Songs mostly
// played at this time rank above everyday favourites.
export async function dailyPool(userId: string, tz: string, partKey: string, taste: Taste): Promise<DailyPool> {
  const part = PARTS.find((p) => p.key === partKey)!;
  const now = Date.now();
  const listens = await db.listen.findMany({
    where: { userId, at: { gte: new Date(now - HISTORY_DAYS * DAY) } },
    orderBy: { at: "desc" },
    take: MAX_LISTENS,
    select: { songId: true, at: true, playedMs: true, durationMs: true, reason: true },
  });

  const inPart = new Map<string, number>();
  const overall = new Map<string, number>();
  for (const l of listens) {
    if (taste.disliked.has(l.songId)) continue;
    if (l.reason === "skip" && l.playedMs < 30_000) continue;
    const heard = l.durationMs ? Math.min(1, l.playedMs / (0.8 * l.durationMs)) : Math.min(1, l.playedMs / 120_000);
    const w = heard * Math.exp(-(now - l.at.getTime()) / (45 * DAY)) * (l.reason === "skip" ? 0.5 : 1);
    if (w <= 0) continue;
    overall.set(l.songId, (overall.get(l.songId) ?? 0) + w);
    const c = closeness(local(l.at, tz).hour, part);
    if (c) inPart.set(l.songId, (inPart.get(l.songId) ?? 0) + w * c);
  }

  const weights = new Map<string, number>();
  for (const [id, w] of inPart) weights.set(id, w * (0.6 + 0.8 * Math.min(1, w / overall.get(id)!)));
  // Not much yet at this time of day: their favourites lately fill in, quieter.
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total < THIN) {
    const favourites = [...taste.current].filter(([id, s]) => s > 0 && !taste.disliked.has(id)).sort((a, b) => b[1] - a[1]).slice(0, POOL_SIZE);
    const top = favourites[0]?.[1] ?? 1;
    for (const [id, s] of favourites) if (!weights.has(id)) weights.set(id, (0.3 * s) / top);
  }

  const ids = [...weights].sort((a, b) => b[1] - a[1]).slice(0, POOL_SIZE).map(([id]) => id);
  const credits = await db.songArtist.findMany({
    where: { songId: { in: [...new Set([...weights.keys(), ...overall.keys()])] }, role: "primary" },
    orderBy: { position: "asc" },
    select: { songId: true, artistId: true },
  });
  const leads = new Map<string, string>();
  for (const c of credits) if (!leads.has(c.songId)) leads.set(c.songId, c.artistId);
  return { ids, weights, overall, leads };
}

// --- Its source: one of the search Spices ---

// Search Spices are genre and scene pools ("K-Pop", "Eurovision", "2012")
// built from editors' playlists. The one whose songs and artists overlap
// most with what someone plays at this time of day, more than at other
// times, joins their Daily Spice and names it. Each part of the day has
// its own, so the source rotates as the day goes on.

const MIN_MATCH = 0.08; // share of their listening the pool must cover to name the Spice
const MIN_NAME = 3; // "Me" makes a bad title
// So there's something to rotate through before anyone has searched much.
export const STARTER_SEARCHES = ["Pop", "Hip Hop", "R&B", "Rock", "Indie", "Dance", "K-Pop", "Chill", "Latin", "Throwbacks"];

export interface Source {
  id: string;
  name: string;
  poolIds: string[];
  leads: Map<string, string>; // pool song → lead artist id
  artists: Set<string>;
}

let sourcesCache: { at: number; sources: Promise<Source[]> } | undefined;
const SOURCES_MS = 60 * 60_000;

// Search Spices with songs, and each pool's lead artists. Shared by everyone.
export function searchSources(): Promise<Source[]> {
  if (sourcesCache && Date.now() - sourcesCache.at < SOURCES_MS) return sourcesCache.sources;
  const sources = (async () => {
    const spices = await db.spice.findMany({ where: { queryKey: { not: null }, NOT: { poolIds: { isEmpty: true } } }, select: { id: true, name: true, poolIds: true } });
    const usable = spices.filter((s) => s.name.trim().length >= MIN_NAME);
    const credits = await db.songArtist.findMany({
      where: { songId: { in: usable.flatMap((s) => s.poolIds) }, role: "primary" },
      orderBy: { position: "asc" },
      select: { songId: true, artistId: true },
    });
    const leadOf = new Map<string, string>();
    for (const c of credits) if (!leadOf.has(c.songId)) leadOf.set(c.songId, c.artistId);
    return usable.map((s) => {
      const leads = new Map(s.poolIds.flatMap((id) => (leadOf.has(id) ? [[id, leadOf.get(id)!] as const] : [])));
      return { ...s, leads, artists: new Set(leads.values()) };
    });
  })();
  sourcesCache = { at: Date.now(), sources };
  sources.catch(() => (sourcesCache = undefined));
  return sources;
}

// How much of their listening a pool covers: its own songs fully, other
// songs by its artists half.
function coverage(source: Source, songs: Map<string, number>, leads: Map<string, string>): number {
  let covered = 0;
  let total = 0;
  const pool = new Set(source.poolIds);
  for (const [id, w] of songs) {
    total += w;
    if (pool.has(id)) covered += w;
    else if (source.artists.has(leads.get(id) ?? "")) covered += 0.5 * w;
  }
  return total ? covered / total : 0;
}

// The best source for now, avoiding the one just used so it rotates.
export async function pickSource(pool: DailyPool, previousId: string | undefined): Promise<Source | undefined> {
  const sources = await searchSources();
  let best: { source: Source; score: number } | undefined;
  for (const source of sources) {
    const now = coverage(source, pool.weights, pool.leads);
    if (now < MIN_MATCH) continue;
    const allDay = coverage(source, pool.overall, pool.leads) || now;
    const lift = Math.min(2, Math.max(0.5, now / allDay));
    const score = now * lift * (source.id === previousId ? 0.6 : 1);
    if (!best || score > best.score) best = { source, score };
  }
  return best?.source;
}

export function dailyName(name: string, part: DayPart, source?: string): string {
  return [`${firstName(name)}'s`, part.label, source, "Spice"].filter(Boolean).join(" ");
}
