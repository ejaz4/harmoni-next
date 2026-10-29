import { normalizeText } from "../matching/normalize";
import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ArtistProfile, DiscoverySeed, ProviderPlugin, ReleaseCandidate, ReleaseDetails, ReleaseKind, SongCandidate } from "./types";

const PREFIX = "deezer";
const API = "https://api.deezer.com";

interface DeezerTrack {
  id: number;
  title: string;
  isrc?: string;
  duration: number;
  explicit_lyrics: boolean;
  artist: { id: number; name: string };
  contributors?: { id: number; name: string }[];
  album?: { id: number; title: string; cover_xl?: string; cover_big?: string };
}

interface DeezerArtist {
  id: number;
  name: string;
  nb_fan?: number;
  picture_xl?: string;
  picture_big?: string;
}

interface DeezerAlbum {
  id: number;
  title: string;
  cover_xl?: string;
  cover_big?: string;
  release_date?: string;
  record_type?: string;
  nb_tracks?: number;
  label?: string;
  genres?: { data: { name: string }[] };
}

interface DeezerPlaylist {
  id: number;
  title: string;
  nb_tracks?: number;
  user?: { name?: string };
}

interface DeezerList<T> {
  data?: T[];
  total?: number;
}

// Whether a title names what was searched, as whole words. One-word
// searches also match two words run together ("kpop" in "Top K-Pop").
export function namedFor(title: string, query: string): boolean {
  const q = normalizeText(query);
  const words = normalizeText(title).split(" ");
  if (` ${words.join(" ")} `.includes(` ${q} `)) return true;
  return !q.includes(" ") && words.some((w, i) => i > 0 && words[i - 1] + w === q);
}

const RECORD_TYPES: Record<string, ReleaseKind> = { album: "album", ep: "ep", single: "single", compile: "compilation" };

// Public API, no key needed. Search results include ISRCs, which makes
// Deezer a strong anchor for matching; its artist pages give the clearest
// discography (types, release dates) and similar artists.
export function deezer(): ProviderPlugin {
  async function get<T>(path: string): Promise<T> {
    let body: T & { error?: { message: string; code: number } };
    try {
      const res = await fetch(`${API}${path}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      throw new ProviderError("Unavailable", PREFIX, `${path} failed`, { cause: err });
    }
    if (body.error) {
      // Code 4 is Deezer's quota error; 800 means "no data" (not found).
      const kind = body.error.code === 4 ? "RateLimited" : body.error.code === 800 ? "NotFound" : "Unavailable";
      throw new ProviderError(kind, PREFIX, body.error.message);
    }
    return body;
  }

  const toCandidate = (t: DeezerTrack, album?: DeezerAlbum): SongCandidate => {
    const albumInfo = album ?? t.album;
    // Contributors list everyone credited (features included); fall back to the main artist.
    const credits = t.contributors?.length ? t.contributors : [t.artist];
    return {
      source: formatSource(PREFIX, t.id),
      title: t.title,
      artists: credits.map((a) => ({ name: a.name, source: formatSource(PREFIX, a.id) })),
      album: albumInfo ? { name: albumInfo.title, source: formatSource(PREFIX, albumInfo.id) } : undefined,
      durationMs: t.duration * 1000,
      isrc: t.isrc || undefined,
      explicit: t.explicit_lyrics,
      artworkUrl: albumInfo?.cover_xl ?? albumInfo?.cover_big,
    };
  };

  const toRelease = (a: DeezerAlbum): ReleaseCandidate => ({
    source: formatSource(PREFIX, a.id),
    title: a.title,
    artworkUrl: a.cover_xl ?? a.cover_big,
    releaseDate: a.release_date || undefined,
    kind: RECORD_TYPES[a.record_type ?? ""],
    trackCount: a.nb_tracks,
  });

  // The artist's id here: one we know, else the best match by name.
  async function artistId(seed: DiscoverySeed): Promise<string | undefined> {
    const known = seed.artistSources.find((s) => s.provider === PREFIX)?.externalId;
    if (known || !seed.artists[0]) return known;
    const body = await get<DeezerList<DeezerArtist>>(`/search/artist?q=${encodeURIComponent(seed.artists[0])}&limit=5`);
    return body.data?.find((a) => normalizeText(a.name) === normalizeText(seed.artists[0]))?.id.toString();
  }

  return {
    prefix: PREFIX,
    name: "Deezer",
    metadataPriority: 20,
    search: {
      async searchSongs(query, limit) {
        const body = await get<DeezerList<DeezerTrack>>(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        return (body.data ?? []).map((t) => toCandidate(t));
      },
    },
    artist: {
      async findArtist(name) {
        const body = await get<DeezerList<DeezerArtist>>(`/search/artist?q=${encodeURIComponent(name)}&limit=10`);
        // Same name, most fans: the one people mean.
        const best = (body.data ?? [])
          .filter((a) => normalizeText(a.name) === normalizeText(name))
          .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))[0];
        return best ? { name: best.name, source: formatSource(PREFIX, best.id) } : undefined;
      },

      async getArtist(id): Promise<ArtistProfile> {
        const [artist, top, albums, related] = await Promise.all([
          get<DeezerArtist>(`/artist/${id}`),
          get<DeezerList<DeezerTrack>>(`/artist/${id}/top?limit=20`),
          get<DeezerList<DeezerAlbum>>(`/artist/${id}/albums?limit=200`),
          get<DeezerList<DeezerArtist>>(`/artist/${id}/related?limit=12`).catch(() => ({ data: [] }) as DeezerList<DeezerArtist>),
        ]);
        return {
          source: formatSource(PREFIX, artist.id),
          name: artist.name,
          imageUrl: artist.picture_xl ?? artist.picture_big,
          fans: artist.nb_fan,
          topTracks: (top.data ?? []).map((t) => toCandidate(t)),
          releases: (albums.data ?? []).map(toRelease),
          related: (related.data ?? []).map((a) => ({
            name: a.name,
            source: formatSource(PREFIX, a.id),
            imageUrl: a.picture_xl ?? a.picture_big,
          })),
        };
      },

      async getRelease(id): Promise<ReleaseDetails> {
        // The album's own track list lacks ISRCs; the tracks endpoint has them.
        const [album, tracks] = await Promise.all([
          get<DeezerAlbum>(`/album/${id}`),
          get<DeezerList<DeezerTrack>>(`/album/${id}/tracks?limit=300`),
        ]);
        return {
          ...toRelease(album),
          label: album.label || undefined,
          genres: album.genres?.data.map((g) => g.name),
          tracks: (tracks.data ?? []).map((t) => toCandidate(t, album)),
        };
      },
    },
    // Artist radio: the artist and those like them, in a listenable order.
    discovery: {
      async similarSongs(seed) {
        const id = await artistId(seed);
        if (!id) return [];
        const body = await get<DeezerList<DeezerTrack>>(`/artist/${id}/radio?limit=40`);
        return (body.data ?? []).map((t) => toCandidate(t));
      },
      // Playlists Deezer's own editors made, named for what was searched:
      // "k-pop" finds Top K-Pop; a song title only finds fans' playlists.
      async findCollections(query) {
        const body = await get<DeezerList<DeezerPlaylist>>(`/search/playlist?q=${encodeURIComponent(query)}&limit=25`);
        return (body.data ?? [])
          .filter((p) => /\bdeezer\b/i.test(p.user?.name ?? "") && (p.nb_tracks ?? 0) >= 20 && namedFor(p.title, query))
          .map((p) => ({ source: formatSource(PREFIX, `playlist:${p.id}`), title: p.title }));
      },
      async collectionSongs(source) {
        const id = source.match(/^deezer:playlist:(\d+)$/)?.[1];
        if (!id) return [];
        const body = await get<DeezerList<DeezerTrack>>(`/playlist/${id}/tracks?limit=100`);
        return (body.data ?? []).map((t) => toCandidate(t));
      },
    },
  };
}
