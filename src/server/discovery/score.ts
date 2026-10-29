// How much someone likes a song, from what they've done with it. Pure
// functions over SongStat-shaped numbers, so the maths is easy to test.

const DAY = 24 * 60 * 60_000;

export interface SongSignals {
  listens: number;
  completes: number;
  skips: number;
  earlySkips: number;
  replays: number;
  lastAt: Date;
}

export interface LibrarySignals {
  liked: boolean;
  playlists: number; // how many of their playlists it's in
}

// Listens that held their attention, and ones they turned away from.
function engagement(s: SongSignals) {
  const neutral = Math.max(0, s.listens - s.completes - s.skips);
  const engaged = s.completes + 0.5 * neutral + 0.75 * s.replays;
  const rejected = s.earlySkips + 0.4 * (s.skips - s.earlySkips);
  return { engaged, rejected };
}

const halfLife = (since: number, days: number) => 0.5 ** (Math.max(0, since) / (days * DAY));

// Roughly -4 (always skipped) to 10+ (liked, in playlists, on repeat).
// Listening fades over a couple of months but never to nothing; library
// signals don't fade, since they were deliberate.
export function songAffinity(s: SongSignals | undefined, lib: LibrarySignals, now = Date.now()): number {
  let score = (lib.liked ? 2.5 : 0) + Math.min(lib.playlists, 3) * 1.2;
  if (!s) return score;
  const { engaged, rejected } = engagement(s);
  const play = 1.6 * Math.log2(1 + engaged) - 1.4 * Math.log2(1 + rejected);
  score += play > 0 ? play * (0.35 + 0.65 * halfLife(now - s.lastAt.getTime(), 60)) : play;
  return score;
}

// What they're into right now, for picking recommendation seeds.
export function currentAffinity(affinity: number, lastAt: Date, now = Date.now()): number {
  return affinity > 0 ? affinity * halfLife(now - lastAt.getTime(), 14) : affinity;
}

// Turned away from it more than once and never stayed for it.
export function isDisliked(s: SongSignals | undefined, lib: LibrarySignals): boolean {
  if (!s || lib.liked || lib.playlists) return false;
  const { engaged, rejected } = engagement(s);
  return rejected >= 2 && engaged < 0.5;
}

// --- Listens ---

export const SLICES = 20; // the song in 5% slices, for "heard"
const EARLY_SKIP_MS = 30_000;

export interface ListenReport {
  playedMs: number;
  positionMs: number;
  durationMs?: number;
  reason: "ended" | "skip" | "back" | "close" | "error";
}

// What one listen adds to the running totals.
export function classifyListen(l: ListenReport): { complete: boolean; skip: boolean; earlySkip: boolean } {
  const fraction = l.durationMs ? l.positionMs / l.durationMs : undefined;
  const complete = l.reason === "ended" || (fraction !== undefined && fraction >= 0.9);
  const skip = !complete && (l.reason === "skip" || l.reason === "back") && (fraction === undefined || fraction < 0.8);
  return { complete, skip, earlySkip: skip && l.playedMs < EARLY_SKIP_MS };
}

export function heardSlices(mask: number): number[] {
  return Array.from({ length: SLICES }, (_, i) => (mask >>> i) & 1);
}

// --- Picking ---

// Best-first, at most `perArtist` songs by any one lead artist and never
// the same artist twice in a row (unless nothing else is left).
export function diversify<T>(items: T[], artistOf: (item: T) => string | undefined, limit: number, perArtist = 2): T[] {
  const out: T[] = [];
  const count = new Map<string, number>();
  const pool = [...items];
  while (out.length < limit && pool.length) {
    const last = out.length ? artistOf(out[out.length - 1]) : undefined;
    let i = pool.findIndex((item) => {
      const a = artistOf(item);
      return !a || ((count.get(a) ?? 0) < perArtist && a !== last);
    });
    if (i < 0) i = pool.findIndex((item) => (count.get(artistOf(item) ?? "") ?? 0) < perArtist);
    if (i < 0) break;
    const [item] = pool.splice(i, 1);
    const a = artistOf(item);
    if (a) count.set(a, (count.get(a) ?? 0) + 1);
    out.push(item);
  }
  return out;
}

// A weighted pick of `n` without replacement, so the same favourites don't
// seed every mix.
export function weightedSample<T>(items: { item: T; weight: number }[], n: number, random = Math.random): T[] {
  const pool = items.filter((i) => i.weight > 0);
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((sum, i) => sum + i.weight, 0);
    let r = random() * total;
    const index = pool.findIndex((i) => (r -= i.weight) <= 0);
    out.push(pool.splice(index < 0 ? pool.length - 1 : index, 1)[0].item);
  }
  return out;
}
