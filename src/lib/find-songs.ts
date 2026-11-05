import type { SongResult } from "@/server/library/song-view";

// Finding songs within a list (a playlist, Liked Songs, a Spice): every
// word typed has to be somewhere in the title, artists or album. Case,
// accents and punctuation don't count, so "beyonce" finds "Beyoncé" and
// "dont" finds "Don't".

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const haystacks = new WeakMap<SongResult, string>();
function haystack(song: SongResult): string {
  let h = haystacks.get(song);
  if (h === undefined) {
    h = ` ${normalize([song.title, ...song.artists.map((a) => a.name), song.album?.title ?? ""].join(" "))} `;
    haystacks.set(song, h);
  }
  return h;
}

// `items` that match, in the order they came.
export function findItems<T>(items: T[], song: (item: T) => SongResult, query: string): T[] {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const h = haystack(song(item));
    return words.every((w) => h.includes(w));
  });
}
