// Provider plugins. Each plugin owns one prefix ("ytm", "deezer") and
// implements whichever roles it supports. Plugins return plain data and
// never touch the database; the server decides what to store.

export interface ProviderPlugin {
  prefix: string;
  name: string;
  search?: SearchProvider;
  song?: SongProvider;
  // Lower number = more trusted for canonical metadata (title casing, artwork).
  metadataPriority?: number;
}

export type ProviderRole = "search" | "song";

export interface SearchProvider {
  searchSongs(query: string, limit: number): Promise<SongCandidate[]>;
  // Best guesses for a recording with this ISRC. May be wrong when the
  // provider has no such recording, so callers still check title and duration.
  searchByIsrc?(isrc: string): Promise<SongCandidate[]>;
}

export interface SongProvider {
  // Should only resolve once audio is actually flowing, so a dead source
  // fails here and the resolver can move on to the next one. `start` is a
  // byte offset for seeking; providers that can't seek return from 0.
  resolveStream(externalId: string, start?: number): Promise<AudioStream>;
  // False for sources that are already local (files, a LAN server),
  // which would only double disk usage if cached.
  cacheable?: boolean;
}

export interface AudioStream {
  body: ReadableStream<Uint8Array>;
  mimeType: string;
  ext: string;
  start: number; // byte offset the body begins at
  totalLength?: number; // size of the whole file; unknown means no seeking
}

export interface ProviderRef {
  name: string;
  source?: string; // "ytm:UCxyz"
}

export interface SongCandidate {
  source: string; // "ytm:d7YHgFvNbJgJ"
  title: string;
  artists: ProviderRef[];
  album?: ProviderRef;
  durationMs?: number;
  isrc?: string;
  explicit?: boolean;
  artworkUrl?: string;
}
