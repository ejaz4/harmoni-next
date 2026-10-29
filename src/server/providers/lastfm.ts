import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin } from "./types";

const PREFIX = "lastfm";
const API = "https://ws.audioscrobbler.com/2.0/";

const MIN_TAG_REACH = 5000;

const toCandidate = (t: LastfmTrack) => ({
  source: formatSource(PREFIX, t.url.replace(/^https?:\/\/www\.last\.fm\/music\//, "")),
  title: t.name,
  artists: [{ name: t.artist.name }],
});

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
  async function call<T>(params: Record<string, string>): Promise<T & { error?: number; message?: string }> {
    let body: T & { error?: number; message?: string };
    try {
      const res = await fetch(`${API}?${new URLSearchParams({ ...params, api_key: apiKey, format: "json" })}`);
      body = await res.json();
    } catch (err) {
      throw new ProviderError("Unavailable", PREFIX, `${params.method} failed`, { cause: err });
    }
    // 6 is "not found"; 29 is the rate limit; 10 and 26 are bad keys.
    if (body.error && body.error !== 6) {
      const kind = body.error === 29 ? "RateLimited" : body.error === 10 || body.error === 26 ? "AuthFailed" : "Unavailable";
      throw new ProviderError(kind, PREFIX, body.message ?? `error ${body.error}`);
    }
    return body;
  }

  return {
    prefix: PREFIX,
    name: "Last.fm",
    discovery: {
      textOnly: true,
      async similarSongs(seed) {
        if (!seed.artists[0]) return [];
        const body = await call<{ similartracks?: { track?: LastfmTrack[] } }>({
          method: "track.getSimilar",
          track: seed.title,
          artist: seed.artists[0],
          autocorrect: "1",
          limit: "30",
        });
        return (body.similartracks?.track ?? []).map(toCandidate);
      },
      // Tags are Last.fm's genres and moods, as listeners use them. Only
      // well-used ones count, so "k-pop" does and a typo doesn't.
      async findCollections(query) {
        const body = await call<{ tag?: { name: string; reach?: number } }>({ method: "tag.getInfo", tag: query });
        return body.tag && (body.tag.reach ?? 0) >= MIN_TAG_REACH ? [{ source: formatSource(PREFIX, `tag:${body.tag.name}`), title: body.tag.name }] : [];
      },
      async collectionSongs(source) {
        const tag = source.match(/^lastfm:tag:(.+)$/)?.[1];
        if (!tag) return [];
        const body = await call<{ tracks?: { track?: LastfmTrack[] } }>({ method: "tag.getTopTracks", tag, limit: "40" });
        return (body.tracks?.track ?? []).map(toCandidate);
      },
    },
  };
}
