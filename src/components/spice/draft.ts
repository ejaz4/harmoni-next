import type { SongResult } from "@/server/library/song-view";

// The songs a new Spice starts from when the picker opens: a song's
// "New Spice…" hands its song over this way.
let pending: SongResult[] = [];

export function startSpiceWith(songs: SongResult[]) {
  pending = songs;
}

export const spiceDraft = () => pending;
