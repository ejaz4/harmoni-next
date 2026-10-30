// Shuffling the queue, and putting it back. Shuffling tags each song with
// its place in the order it came in (`pos`) and keeps that order, so turning
// shuffle off can carry on from the current song the way the list goes.

export type Shuffleable = { id: string; autoplay?: true; pos?: number };

export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Everything after `index` shuffled; what's played and playing stays put.
// Autoplay's songs are picked to flow on from yours, so they aren't
// shuffled in: they stay after yours, in their own order.
// `first` moves that song to `index` first (playing a list from one song).
export function shuffleQueue<T extends Shuffleable>(queue: T[], index: number, first?: number): { queue: T[]; unshuffled: T[] } {
  const tagged = queue.map((song, pos) => (song.autoplay ? song : { ...song, pos }));
  const unshuffled = tagged.filter((s) => !s.autoplay);
  if (first !== undefined) {
    const rest = tagged.filter((_, i) => i !== first);
    return { queue: [...rest.slice(0, index), tagged[first], ...shuffled(rest.slice(index))], unshuffled };
  }
  const upcoming = tagged.slice(index + 1);
  return {
    queue: [...tagged.slice(0, index + 1), ...shuffled(upcoming.filter((s) => !s.autoplay)), ...upcoming.filter((s) => s.autoplay)],
    unshuffled,
  };
}

// Back to the list's own order from the current song on: songs queued by
// hand while shuffled come first, then the rest of the list (minus any
// removed from the queue), then whatever autoplay lined up.
export function unshuffleQueue<T extends Shuffleable>(queue: T[], index: number, unshuffled?: T[]): T[] {
  const untag = (songs: T[]) =>
    songs.map((song) => {
      const copy = { ...song };
      delete copy.pos;
      return copy;
    });
  // The last song from the list played so far (the current one, unless it was queued by hand).
  const anchor = queue.slice(0, index + 1).findLast((s) => s.pos !== undefined);
  if (!unshuffled || anchor?.pos === undefined) return untag(queue);
  const upcoming = queue.slice(index + 1);
  const kept = new Set(queue.map((s) => s.pos));
  const added = upcoming.filter((s) => s.pos === undefined && !s.autoplay);
  const rest = unshuffled.filter((s) => s.pos! > anchor.pos! && kept.has(s.pos));
  const autoplay = upcoming.filter((s) => s.pos === undefined && s.autoplay);
  return untag([...queue.slice(0, index + 1), ...added, ...rest, ...autoplay]);
}
