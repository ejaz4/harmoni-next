import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "itunes";

interface ITunesTrack {
  kind?: string;
  trackId: number;
  trackName: string;
  artistId?: number;
  artistName: string;
  collectionId?: number;
  collectionName?: string;
  trackTimeMillis?: number;
  trackExplicitness?: "explicit" | "notExplicit" | "cleaned";
  artworkUrl100?: string;
}

// Apple's public Search API: no account or key. Strong catalogue (especially
// outside the US/UK charts) and accurate durations, but no ISRCs.
// Apple allows roughly 20 requests a minute.
export function itunes(country: string): ProviderPlugin {
  return {
    prefix: PREFIX,
    name: "iTunes",
    metadataPriority: 15,
    search: {
      async searchSongs(query, limit) {
        const params = new URLSearchParams({ term: query, entity: "song", limit: String(limit), country });
        let res: Response;
        try {
          res = await fetch(`https://itunes.apple.com/search?${params}`);
        } catch (err) {
          throw new ProviderError("Unavailable", PREFIX, "search failed", { cause: err });
        }
        // Apple answers 403 when the rate limit is hit.
        if (res.status === 403 || res.status === 429) throw new ProviderError("RateLimited", PREFIX, "too many requests");
        if (!res.ok) throw new ProviderError("Unavailable", PREFIX, `search: HTTP ${res.status}`);

        const body = (await res.json()) as { results: ITunesTrack[] };
        return body.results
          .filter((t) => t.kind === "song")
          .map(
            (t): SongCandidate => ({
              source: formatSource(PREFIX, t.trackId),
              // Censored versions share the title; mark them so they don't match the original.
              title: t.trackExplicitness === "cleaned" && !/\bclean\b/i.test(t.trackName) ? `${t.trackName} (Clean)` : t.trackName,
              artists: [{ name: t.artistName, source: t.artistId ? formatSource(PREFIX, t.artistId) : undefined }],
              album: t.collectionName
                ? {
                    name: t.collectionName.replace(/ - (Single|EP)$/, ""),
                    source: t.collectionId ? formatSource(PREFIX, t.collectionId) : undefined,
                  }
                : undefined,
              durationMs: t.trackTimeMillis,
              explicit: t.trackExplicitness === "explicit",
              artworkUrl: t.artworkUrl100?.replace(/\/100x100bb\./, "/600x600bb."),
            }),
          );
      },
    },
  };
}
