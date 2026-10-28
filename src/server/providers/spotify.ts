import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "spotify";
// Apps in Spotify's development mode are capped at 10 results per search.
const MAX_LIMIT = 10;

interface SpotifyTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  external_ids?: { isrc?: string };
  artists: { id: string; name: string }[];
  album: { id: string; name: string; images: { url: string; width: number }[] };
}

// Metadata and search only: Spotify can't be used to stream audio.
export function spotify(clientId: string, clientSecret: string): ProviderPlugin {
  let token: { value: string; expiresAt: number } | undefined;

  async function getToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 30_000) return token.value;
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new ProviderError("AuthFailed", PREFIX, `token request: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  return {
    prefix: PREFIX,
    name: "Spotify",
    metadataPriority: 10,
    search: {
      async searchSongs(query, limit) {
        const params = new URLSearchParams({
          q: query,
          type: "track",
          limit: String(Math.min(limit, MAX_LIMIT)),
        });
        const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
          headers: { Authorization: `Bearer ${await getToken()}` },
        });
        if (res.status === 401) {
          token = undefined;
          throw new ProviderError("AuthFailed", PREFIX, "token rejected");
        }
        if (res.status === 429) throw new ProviderError("RateLimited", PREFIX, "too many requests");
        if (!res.ok) throw new ProviderError("Unavailable", PREFIX, `search: HTTP ${res.status}`);

        const body = (await res.json()) as { tracks?: { items: SpotifyTrack[] } };
        return (body.tracks?.items ?? []).map(
          (t): SongCandidate => ({
            source: formatSource(PREFIX, t.id),
            title: t.name,
            artists: t.artists.map((a) => ({ name: a.name, source: formatSource(PREFIX, a.id) })),
            album: { name: t.album.name, source: formatSource(PREFIX, t.album.id) },
            durationMs: t.duration_ms,
            isrc: t.external_ids?.isrc,
            explicit: t.explicit,
            artworkUrl: t.album.images[0]?.url,
          }),
        );
      },
    },
  };
}
