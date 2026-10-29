import type { Lyrics } from "../lyrics/types";

// Provider plugins. Each plugin owns one prefix ("ytm", "deezer") and
// implements whichever roles it supports. Plugins return plain data and
// never touch the database; the server decides what to store.

export interface ProviderPlugin {
  prefix: string;
  name: string;
  search?: SearchProvider;
  song?: SongProvider;
  lyrics?: LyricsProvider;
  artist?: ArtistProvider;
  discovery?: DiscoveryProvider;
  // Lower number = more trusted for canonical metadata (title casing, artwork).
  metadataPriority?: number;
}

export type ProviderRole = "search" | "song" | "lyrics" | "artist" | "discovery";

// Songs that go with a song, the way a radio would follow it. Used for
// recommendations and autoplay; results are cached, so these can be slow.
export interface DiscoveryProvider {
  similarSongs(seed: DiscoverySeed): Promise<SongCandidate[]>;
  // Results carry only a title and artists (no playable source or artwork),
  // so the server looks each one up with a search provider first.
  textOnly?: boolean;
}

export interface DiscoverySeed {
  title: string;
  artists: string[];
  sources: { provider: string; externalId: string }[]; // the song's
  artistSources: { provider: string; externalId: string }[]; // its main artist's
}

// An artist's catalogue: who they are, what's popular, everything they've
// released, and who's similar. Providers fill in what they can; the server
// merges them.
export interface ArtistProvider {
  // The provider's id for an artist with this name, if it can tell.
  findArtist(name: string): Promise<ProviderRef | undefined>;
  getArtist(externalId: string): Promise<ArtistProfile>;
  // A release's full tracklist, in order.
  getRelease?(externalId: string): Promise<ReleaseDetails>;
}

export interface ArtistProfile {
  source: string;
  name: string;
  imageUrl?: string; // square portrait
  bannerUrl?: string; // wide header photo
  bio?: string;
  fans?: number;
  topTracks: SongCandidate[];
  releases: ReleaseCandidate[];
  related: (ProviderRef & { imageUrl?: string })[];
}

export type ReleaseKind = "album" | "ep" | "single" | "compilation";

export interface ReleaseCandidate {
  source: string; // "deezer:12345"
  title: string;
  artworkUrl?: string;
  releaseDate?: string; // ISO date
  kind?: ReleaseKind;
  trackCount?: number;
}

export interface ReleaseDetails extends ReleaseCandidate {
  label?: string;
  genres?: string[];
  tracks: SongCandidate[]; // in tracklist order
}

export interface LyricsQuery {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  sources: { provider: string; externalId: string }[]; // the song's known sources
}

export interface LyricsProvider {
  // undefined when the provider has no lyrics for the song.
  getLyrics(query: LyricsQuery): Promise<Lyrics | undefined>;
}

export interface SearchProvider {
  searchSongs(query: string, limit: number): Promise<SongCandidate[]>;
  // Results only attach to songs other providers found (adding ISRCs and
  // confirming matches) and are never shown on their own.
  attachOnly?: boolean;
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
