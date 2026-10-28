import { db } from "../db";
import { compare, prepare } from "../matching/matcher";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import { mergeSongs, persistGroup, toHit, type Hit } from "../search/persist";
import { isBenched } from "./health";

const SEARCH_DEADLINE_MS = 5000;
const RETRY_AFTER_MS = 10 * 60_000;

// Songs with nothing found recently, so they aren't searched on every play.
const unresolvedUntil = new Map<string, number>();

interface SongToMatch {
  id: string;
  title: string;
  artists: string[];
  durationMs?: number;
  isrc?: string;
  linked: Set<string>; // source URIs already on the song
}

// Finds playable copies of a song by searching the providers that can stream
// it and running the matcher. Returns how many new sources were linked.
export async function crossmatch(song: SongToMatch): Promise<number> {
  if ((unresolvedUntil.get(song.id) ?? 0) > Date.now()) return 0;

  const target = prepare(song);
  const query = `${song.artists[0] ?? ""} ${song.title}`.trim();
  const providers = getRegistry()
    .withRole("song")
    .filter((p) => p.search && !isBenched(p.prefix));

  const found = await Promise.all(
    providers.map(async (p) => {
      try {
        const candidates = await withDeadline(p.search!.searchSongs(query, 10), SEARCH_DEADLINE_MS, p.prefix);
        let best: { hit: Hit; score: number; reason: string } | undefined;
        candidates.forEach((c, rank) => {
          if (song.linked.has(c.source)) return;
          const hit = toHit(c, rank);
          const r = compare(target, hit.prepared);
          if (r.decision === "match" && (!best || r.score > best.score)) best = { hit, score: r.score, reason: r.reason };
        });
        return best;
      } catch (err) {
        console.warn(`crossmatch: ${p.prefix} search failed`, err);
        return undefined;
      }
    }),
  );

  const members = found.flatMap((b) =>
    b ? [{ hit: b.hit, confidence: b.score, matchedBy: b.reason === "isrc" ? ("isrc" as const) : ("fuzzy" as const) }] : [],
  );
  if (!members.length) {
    unresolvedUntil.set(song.id, Date.now() + RETRY_AFTER_MS);
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
  console.info(`crossmatch: linked ${members.map((m) => m.hit.candidate.source).join(", ")} to ${song.id}`);
  return members.length;
}
