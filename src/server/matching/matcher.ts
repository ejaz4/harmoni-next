import { normalizeText, parseTitle, splitArtistNames } from "./normalize";
import { jaroWinkler, levenshteinRatio, tokenSortRatio } from "./similarity";

export const AUTO_MERGE = 0.92;
export const UNCERTAIN = 0.75;
// Providers disagree on duration by a few seconds (rounding, encoder padding):
// Deezer has White Keys at 141s, YouTube serves 144s and lists 2:25. Small gaps
// cost a little score; only large ones (edits, extended mixes) rule a match out.
const DURATION_FREE_MS = 2500;
const DURATION_REJECT_MS = 8000;
const DURATION_PENALTY_PER_S = 0.02;
const ARTIST_FUZZ = 0.85;

export interface TrackInfo {
  title: string;
  artists: string[];
  durationMs?: number;
  isrc?: string;
}

export type MatchDecision = "match" | "uncertain" | "different";
export type MatchReason = "isrc" | "version" | "duration" | "fuzzy";

export interface MatchResult {
  decision: MatchDecision;
  score: number;
  reason: MatchReason;
}

interface Prepared {
  core: string;
  titles: string[]; // core plus any translations, compared pairwise
  tags: Set<string>;
  artists: string[]; // normalised, primary first, featured included
  durationMs?: number;
  isrc?: string;
}

export function prepare(track: TrackInfo): Prepared {
  const parsed = parseTitle(track.title);
  return {
    core: parsed.core,
    titles: [parsed.core, ...parsed.alts],
    tags: parsed.tags,
    artists: splitArtistNames([...track.artists, ...parsed.featured]).map(normalizeText),
    durationMs: track.durationMs,
    isrc: track.isrc?.toUpperCase(),
  };
}

// Layered, cheapest first. A wrong merge plays the wrong song, so anything
// unsure stays "uncertain" and the caller keeps the songs apart.
export function compare(a: TrackInfo | Prepared, b: TrackInfo | Prepared): MatchResult {
  const pa = "core" in a ? a : prepare(a);
  const pb = "core" in b ? b : prepare(b);

  if (pa.isrc && pa.isrc === pb.isrc) {
    return { decision: "match", score: 1, reason: "isrc" };
  }
  if (!sameSet(pa.tags, pb.tags)) {
    return { decision: "different", score: 0, reason: "version" };
  }
  const gap =
    pa.durationMs !== undefined && pb.durationMs !== undefined ? Math.abs(pa.durationMs - pb.durationMs) : 0;
  if (gap > DURATION_REJECT_MS) {
    return { decision: "different", score: 0, reason: "duration" };
  }
  const durationPenalty = (Math.max(0, gap - DURATION_FREE_MS) / 1000) * DURATION_PENALTY_PER_S;

  const title = Math.max(...pa.titles.flatMap((ta) => pb.titles.map((tb) => titleScore(ta, tb))));
  const score = 0.6 * title + 0.4 * artistScore(pa.artists, pb.artists) - durationPenalty;
  const decision = score >= AUTO_MERGE ? "match" : score >= UNCERTAIN ? "uncertain" : "different";
  return { decision, score, reason: "fuzzy" };
}

function titleScore(a: string, b: string): number {
  if (!a || !b) return 0;
  return 0.7 * tokenSortRatio(a, b) + 0.3 * jaroWinkler(a, b);
}

// Providers disagree on credits (Deezer often lists only the primary artist),
// so this rewards a shared primary artist and overlap, not equal lists.
function artistScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0.5;
  const has = (list: string[], name: string) =>
    list.some((n) => n === name || levenshteinRatio(n, name) >= ARTIST_FUZZ);
  const primaryShared = has(b, a[0]) || has(a, b[0]);
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  const overlap = small.filter((n) => has(large, n)).length / small.length;
  return primaryShared ? 0.5 + 0.5 * overlap : 0.5 * overlap;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
