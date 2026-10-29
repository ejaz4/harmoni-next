import type { SongResult } from "@/server/library/song-view";

export type SortField = "order" | "title" | "artist";
export interface SongSort {
  field: SortField;
  descending: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const artistOf = (s: SongResult) => s.artists[0]?.name ?? "";

// `items` in their own order, oldest or best first.
export function sortItems<T>(items: T[], song: (item: T) => SongResult, sort: SongSort): T[] {
  const ranked = items.map((item, i) => ({ item, i, song: song(item) }));
  const compare = (a: (typeof ranked)[number], b: (typeof ranked)[number]) => {
    if (sort.field === "title") return collator.compare(a.song.title, b.song.title) || collator.compare(artistOf(a.song), artistOf(b.song));
    if (sort.field === "artist") return collator.compare(artistOf(a.song), artistOf(b.song)) || collator.compare(a.song.title, b.song.title);
    return 0;
  };
  // Ties keep the list's own order whichever way it's sorted.
  ranked.sort((a, b) => (sort.descending ? -compare(a, b) : compare(a, b)) || (sort.field === "order" && sort.descending ? b.i - a.i : a.i - b.i));
  return ranked.map((r) => r.item);
}
