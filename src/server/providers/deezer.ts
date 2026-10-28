import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "deezer";
const API = "https://api.deezer.com";

interface DeezerTrack {
  id: number;
  title: string;
  isrc?: string;
  duration: number;
  explicit_lyrics: boolean;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_xl?: string; cover_big?: string };
}

interface DeezerSearchResponse {
  data?: DeezerTrack[];
  error?: { type: string; message: string; code: number };
}

// Public API, no key needed. Search results include ISRCs,
// which makes Deezer a strong anchor for matching.
export function deezer(): ProviderPlugin {
  return {
    prefix: PREFIX,
    name: "Deezer",
    metadataPriority: 20,
    search: {
      async searchSongs(query, limit) {
        const url = `${API}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
        let body: DeezerSearchResponse;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          body = await res.json();
        } catch (err) {
          throw new ProviderError("Unavailable", PREFIX, "search failed", { cause: err });
        }
        if (body.error) {
          // Code 4 is Deezer's quota error.
          const kind = body.error.code === 4 ? "RateLimited" : "Unavailable";
          throw new ProviderError(kind, PREFIX, body.error.message);
        }

        return (body.data ?? []).map(
          (t): SongCandidate => ({
            source: formatSource(PREFIX, t.id),
            title: t.title,
            artists: [{ name: t.artist.name, source: formatSource(PREFIX, t.artist.id) }],
            album: { name: t.album.title, source: formatSource(PREFIX, t.album.id) },
            durationMs: t.duration * 1000,
            isrc: t.isrc || undefined,
            explicit: t.explicit_lyrics,
            artworkUrl: t.album.cover_xl ?? t.album.cover_big,
          }),
        );
      },
    },
  };
}
