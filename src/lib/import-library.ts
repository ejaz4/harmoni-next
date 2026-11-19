// A library from another service, boiled down to what Harmoni brings in.
// The files are read in the browser (src/lib/apple-library.ts,
// src/lib/spotify-library.ts) and only this summary is sent to
// POST /api/import.

export type ImportSource = "apple" | "spotify";

export interface ImportTrack {
  id: string; // the service's id for it, within this file (Spotify's track id where it has one)
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  explicit: boolean;
  inLibrary: boolean; // false: only in a playlist or their history
  loved: boolean;
  addedAt?: string;
  plays: number;
  playedAt?: string;
  skips: number;
  skippedAt?: string;
}

export interface ImportPlaylist {
  id: string; // the same in every export, so bringing it in again updates it
  name: string;
  description?: string;
  trackIds: string[]; // in order
}

// How a listen ended, as far as the service says.
export const LISTEN_ENDS = ["unknown", "ended", "skip", "back", "close"] as const;
export type ListenEnd = (typeof LISTEN_ENDS)[number];

// One play from their history, kept small since there can be hundreds of
// thousands: [index into tracks, when it stopped (Unix seconds), ms heard,
// index into LISTEN_ENDS].
export type ImportListen = [track: number, at: number, playedMs: number, end: number];

export interface ImportLibrary {
  source: ImportSource;
  tracks: ImportTrack[];
  playlists: ImportPlaylist[];
  // Every play, where the service keeps them (Spotify). Without them, the
  // tracks' play and skip counts are used (Apple).
  listens?: ImportListen[];
}

// How bringing one in is going (GET /api/import).
export type ImportStatus = "adding" | "improving" | "done" | "failed" | "cancelled";

export interface ImportSummary {
  source?: ImportSource; // missing on imports from before Spotify: Apple
  liked: number; // songs added to their likes
  playlists: { name: string; songs: number }[];
  listening: number; // songs whose plays and skips were counted
  listens?: number; // plays brought in, one by one, from their history
  appliedAt: string; // its playlist songs are dated from here, a millisecond apart
  missing?: { title: string; artist: string }[]; // once improved: no provider had these
}

export interface ImportProgress {
  id: string;
  source: ImportSource;
  status: ImportStatus;
  total: number;
  done: number;
  known: number;
  toImprove: number;
  improved: number;
  found: number;
  summary?: ImportSummary;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export const IMPORT_LIMITS = { tracks: 60_000, playlists: 2000, playlistTracks: 20_000, listens: 600_000 };
