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
}

// Not implemented by any plugin yet; playback comes after search.
export interface SongProvider {
  resolveStream(externalId: string): Promise<ReadableStream<Uint8Array>>;
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
