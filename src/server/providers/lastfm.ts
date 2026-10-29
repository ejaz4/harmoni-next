import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin } from "./types";

const PREFIX = "lastfm";
const API = "https://ws.audioscrobbler.com/2.0/";

interface LastfmTrack {
  name: string;
  url: string;
  match?: number;
  artist: { name: string };
}

// Optional (needs a free API key). Last.fm's similar tracks come from what
// millions of scrobblers play next to each other, which finds things radios
// built from audio and labels miss. It only knows names, so the server looks
// each suggestion up elsewhere before using it.
export function lastfm(apiKey: string): ProviderPlugin {
  return {
    prefix: PREFIX,
    name: "Last.fm",
    discovery: {
      textOnly: true,
      async similarSongs(seed) {
        if (!seed.artists[0]) return [];
        const params = new URLSearchParams({
          method: "track.getSimilar",
          track: seed.title,
          artist: seed.artists[0],
          autocorrect: "1",
          limit: "30",
          api_key: apiKey,
          format: "json",
        });
        let body: { similartracks?: { track?: LastfmTrack[] }; error?: number; message?: string };
        try {
          const res = await fetch(`${API}?${params}`);
          body = await res.json();
        } catch (err) {
          throw new ProviderError("Unavailable", PREFIX, "track.getSimilar failed", { cause: err });
        }
        // 6 is "track not found"; 29 is the rate limit; 10 and 26 are bad keys.
        if (body.error === 6) return [];
        if (body.error) {
          const kind = body.error === 29 ? "RateLimited" : body.error === 10 || body.error === 26 ? "AuthFailed" : "Unavailable";
          throw new ProviderError(kind, PREFIX, body.message ?? `error ${body.error}`);
        }
        return (body.similartracks?.track ?? []).map((t) => ({
          source: formatSource(PREFIX, t.url.replace(/^https?:\/\/www\.last\.fm\/music\//, "")),
          title: t.name,
          artists: [{ name: t.artist.name }],
        }));
      },
    },
  };
}
