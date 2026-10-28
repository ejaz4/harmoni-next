import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "mb";
const API = "https://musicbrainz.org/ws/2";
// MusicBrainz allows one request per second per IP.
const MIN_INTERVAL_MS = 1100;

interface MbRecording {
  id: string;
  title: string;
  length?: number;
  isrcs?: string[];
  disambiguation?: string;
  video?: boolean;
  "artist-credit"?: { name: string; artist: { id: string; name: string } }[];
  releases?: {
    id: string;
    title: string;
    "release-group"?: { "primary-type"?: string; "secondary-types"?: string[] };
  }[];
}

// The open music database: canonical recordings with ISRCs, which lets songs
// from providers without ISRCs (YouTube Music, iTunes) pick one up.
// Attach-only: its search surfaces covers and obscure recordings, so it
// enriches other providers' songs rather than adding results of its own.
export function musicbrainz(userAgent: string): ProviderPlugin {
  let nextSlot = 0;
  const waitForSlot = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + MIN_INTERVAL_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };

  return {
    prefix: PREFIX,
    name: "MusicBrainz",
    metadataPriority: 40,
    search: {
      attachOnly: true,
      async searchSongs(query, limit) {
        // dismax searches title, artist and release together; without it a
        // query like "dominic fike white keys" only matches recording titles.
        const params = new URLSearchParams({ query, fmt: "json", limit: String(limit), dismax: "true" });
        let res: Response | undefined;
        // MusicBrainz answers 503 when it thinks we're over the rate; one retry usually clears it.
        for (let attempt = 0; attempt < 2; attempt++) {
          await waitForSlot();
          try {
            res = await fetch(`${API}/recording?${params}`, { headers: { "User-Agent": userAgent } });
          } catch (err) {
            throw new ProviderError("Unavailable", PREFIX, "search failed", { cause: err });
          }
          if (res.status !== 503 && res.status !== 429) break;
        }
        if (!res || res.status === 503 || res.status === 429) throw new ProviderError("RateLimited", PREFIX, "rate limited");
        if (!res.ok) throw new ProviderError("Unavailable", PREFIX, `search: HTTP ${res.status}`);

        const body = (await res.json()) as { recordings?: MbRecording[] };
        return (body.recordings ?? [])
          .filter((r) => !r.video)
          .map((r): SongCandidate => {
            const release = pickRelease(r);
            return {
              source: formatSource(PREFIX, r.id),
              // Disambiguation carries versions ("live", "remix"), which the matcher reads from the title.
              title: r.disambiguation ? `${r.title} (${r.disambiguation})` : r.title,
              artists: (r["artist-credit"] ?? []).map((c) => ({
                name: c.name,
                source: formatSource(PREFIX, c.artist.id),
              })),
              album: release ? { name: release.title, source: formatSource(PREFIX, release.id) } : undefined,
              durationMs: r.length,
              isrc: r.isrcs?.[0],
            };
          });
      },
    },
  };
}

// Recordings appear on many releases; prefer the original over compilations.
function pickRelease(r: MbRecording) {
  const releases = r.releases ?? [];
  return releases.find((rel) => !rel["release-group"]?.["secondary-types"]?.length) ?? releases[0];
}
