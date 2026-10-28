import { jaroWinkler, levenshteinRatio, tokenSortRatio } from "@/server/matching/similarity";
import { normalizeText } from "@/server/matching/normalize";

// How sure we are that a search means an artist rather than a song, so the
// top result can be the artist when you typed (or nearly typed) their name.

// Below this an artist never takes the top spot.
export const ARTIST_CONFIDENCE = 0.72;

// "The Weeknd" and "weeknd", "Beyoncé" and "beyonce", "Ke$ha" and "kesha".
const bare = (s: string) => normalizeText(s).replace(/^the /, "");

// 0 to 1: how well `query` names `target`. Forgiving of typos (edit
// distance, and Jaro-Winkler for swapped or dropped letters), word order,
// and names you're still typing ("taylor sw").
export function nameConfidence(query: string, target: string): number {
  const q = bare(query);
  const t = bare(target);
  if (!q || !t) return 0;
  if (q === t) return 1;
  const prefix = q.length >= 3 && t.startsWith(q) ? 0.75 + 0.25 * (q.length / t.length) : 0;
  return Math.max(levenshteinRatio(q, t), tokenSortRatio(q, t), jaroWinkler(q, t) * 0.9, prefix);
}

export interface RankedArtist {
  id: string;
  name: string;
  songs: number; // how many results they're on
}

// The artist the query most likely means, if it means one more than it
// means the best song. Ties between artists go to the one with more results.
export function pickTopArtist<A extends RankedArtist>(
  query: string,
  artists: A[],
  topSong?: { title: string; artists: { name: string }[] },
): A | undefined {
  let best: { artist: A; score: number } | undefined;
  for (const artist of artists) {
    const score = nameConfidence(query, artist.name);
    if (!best || score > best.score || (score === best.score && artist.songs > best.artist.songs)) best = { artist, score };
  }
  if (!best || best.score < ARTIST_CONFIDENCE) return undefined;
  if (!topSong) return best.artist;
  // "blank space" or "taylor swift blank space" mean the song.
  const by = topSong.artists[0]?.name ?? "";
  const songScore = Math.max(nameConfidence(query, topSong.title), nameConfidence(query, `${topSong.title} ${by}`), nameConfidence(query, `${by} ${topSong.title}`));
  return best.score >= songScore ? best.artist : undefined;
}
