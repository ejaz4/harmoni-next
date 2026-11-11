import { db } from "../db";
import { AUTO_MERGE, compare, prepare } from "../matching/matcher";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { SongCandidate } from "../providers/types";
import { mergeSongs, persistGroup, toHit, type Hit } from "../search/persist";
import { isBenched } from "./health";

const SEARCH_DEADLINE_MS = 5000;
const RETRY_AFTER_MS = 10 * 60_000;
// Playing a slightly different cut beats playing nothing. When no provider has
// a strict match, a copy whose title and artists alone would auto-merge is
// accepted up to this far off in length. The usual cause is the store and
// YouTube disagreeing on the tail: iTunes has Victorious' "You Don't Know Me"
// at 2:54, YouTube Music at 3:03.
const LOOSE_DURATION_MS = 15_000;
const LOOSE_CONFIDENCE = 0.8;

type Found = { hit: Hit; score: number; reason: string; loose?: boolean };

// Songs every provider was searched for, cleanly, with nothing found, so
// they aren't searched on every play. A search that failed or was skipped
// proves nothing, so it isn't remembered.
const unresolvedUntil = new Map<string, number>();

interface SongToMatch {
  id: string;
  title: string;
  artists: string[];
  durationMs?: number;
  isrc?: string;
  linked: Set<string>; // source URIs already on the song
}

// The provider's ISRC guess is trusted if it is at least a plausible match:
// compilation tracks often lack artists, so they can't reach a full match
// on text alone, but a wrong guess still fails on title or duration.
async function findByIsrc(
  song: SongToMatch,
  target: ReturnType<typeof prepare>,
  searchByIsrc: (isrc: string) => Promise<SongCandidate[]>,
  prefix: string,
): Promise<Found | undefined> {
  const candidates = await withDeadline(searchByIsrc(song.isrc!), SEARCH_DEADLINE_MS, prefix);
  for (const c of candidates) {
    if (song.linked.has(c.source)) continue;
    const hit = toHit(c, 0);
    const r = compare(target, { ...hit.prepared, isrc: undefined });
    if (r.decision !== "different") {
      hit.prepared.isrc = song.isrc!.toUpperCase();
      return { hit, score: r.score, reason: "isrc" };
    }
  }
}

// Finds playable copies of a song by searching the providers that can stream
// it and running the matcher. Returns how many new sources were linked.
export async function crossmatch(song: SongToMatch): Promise<number> {
  if ((unresolvedUntil.get(song.id) ?? 0) > Date.now()) return 0;

  const target = prepare(song);
  const query = `${song.artists[0] ?? ""} ${song.title}`.trim();
  const searchable = getRegistry()
    .withRole("song")
    .filter((p) => p.search);
  const providers = searchable.filter((p) => !isBenched(p.prefix));
  let clean = providers.length === searchable.length;

  const found = await Promise.all(
    providers.map(async (p) => {
      try {
        if (song.isrc && p.search!.searchByIsrc) {
          const byIsrc = await findByIsrc(song, target, p.search!.searchByIsrc.bind(p.search), p.prefix);
          if (byIsrc) return byIsrc;
        }
        const candidates = await withDeadline(p.search!.searchSongs(query, 10), SEARCH_DEADLINE_MS, p.prefix);
        let best: Found | undefined;
        let loose: Found | undefined;
        candidates.forEach((c, rank) => {
          if (song.linked.has(c.source)) return;
          const hit = toHit(c, rank);
          const r = compare(target, hit.prepared);
          if (r.decision === "match" && (!best || r.score > best.score)) best = { hit, score: r.score, reason: r.reason };
          if (best || r.reason === "version") return;
          const gap =
            target.durationMs !== undefined && hit.prepared.durationMs !== undefined
              ? Math.abs(target.durationMs - hit.prepared.durationMs)
              : 0;
          if (gap > LOOSE_DURATION_MS) return;
          const text = compare(target, { ...hit.prepared, durationMs: undefined });
          if (text.score >= AUTO_MERGE && (!loose || text.score > loose.score))
            loose = { hit, score: text.score, reason: "fuzzy", loose: true };
        });
        return best ?? loose;
      } catch (err) {
        console.warn(`crossmatch: ${p.prefix} search failed`, err);
        clean = false;
        return undefined;
      }
    }),
  );

  // Loose copies only count when nothing strict turned up anywhere.
  const strict = found.filter((b) => b && !b.loose);
  const chosen = strict.length ? strict : found.filter(Boolean).slice(0, 1);
  const members = chosen.flatMap((b) =>
    b
      ? [{
          hit: b.hit,
          confidence: b.loose ? Math.min(b.score, LOOSE_CONFIDENCE) : b.score,
          matchedBy: b.reason === "isrc" ? ("isrc" as const) : ("fuzzy" as const),
        }]
      : [],
  );
  if (!members.length) {
    if (clean) unresolvedUntil.set(song.id, Date.now() + RETRY_AFTER_MS);
    console.info(`crossmatch: nothing found for ${song.id} "${query}"`);
    return 0;
  }
  // A match already saved on another song means the two are one recording.
  const fresh: typeof members = [];
  for (const m of members) {
    const existing = await db.songSource.findUnique({
      where: { provider_externalId: m.hit.ref },
      select: { songId: true },
    });
    if (existing && existing.songId !== song.id) await mergeSongs(song.id, existing.songId);
    else if (!existing) fresh.push(m);
  }
  if (fresh.length) await persistGroup({ songId: song.id, members: fresh });
  console.info(`crossmatch: linked ${chosen.some((b) => b?.loose) ? "(loose) " : ""}${members.map((m) => m.hit.candidate.source).join(", ")} to ${song.id}`);
  return members.length;
}
