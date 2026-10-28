import { parseLrc, parsePlain } from "../lyrics/lrc";
import type { Lyrics } from "../lyrics/types";
import { compare } from "../matching/matcher";
import { ProviderError } from "./errors";
import type { LyricsQuery, ProviderPlugin } from "./types";

const PREFIX = "lrclib";
const API = "https://lrclib.net/api";

interface LrclibRecord {
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number; // seconds
  instrumental: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

// Open, community-run lyrics database with line-synced LRC for most songs.
// No key; asks for an identifying User-Agent.
export function lrclib(userAgent: string): ProviderPlugin {
  async function request(path: string, params: Record<string, string>): Promise<Response> {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { headers: { "User-Agent": userAgent } });
      } catch (err) {
        throw new ProviderError("Unavailable", PREFIX, `${path} failed`, { cause: err });
      }
      // LRCLIB answers 503 "server is busy" under load; one retry usually works.
      if (res.status !== 503 || attempt > 0) return res;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return {
    prefix: PREFIX,
    name: "LRCLIB",
    lyrics: {
      async getLyrics(q) {
        const artist = q.artists[0];
        if (!artist) return undefined;

        // Exact lookup first: fast and precise when the names line up.
        const exact = await request("/get", {
          track_name: q.title,
          artist_name: artist,
          ...(q.album && { album_name: q.album }),
          ...(q.durationMs && { duration: String(Math.round(q.durationMs / 1000)) }),
        });
        if (exact.ok) return toLyrics((await exact.json()) as LrclibRecord);
        if (exact.status !== 404) throw statusError(exact.status);

        // Otherwise search and pick the record that matches the song.
        const search = await request("/search", { track_name: q.title, artist_name: artist });
        if (!search.ok) throw statusError(search.status);
        const best = pickBest((await search.json()) as LrclibRecord[], q);
        return best ? toLyrics(best) : undefined;
      },
    },
  };
}

function statusError(status: number) {
  return new ProviderError(status === 503 || status === 429 ? "RateLimited" : "Unavailable", PREFIX, `HTTP ${status}`);
}

// Same matcher as search, so live/remix/language versions don't borrow each other's lyrics.
function pickBest(records: LrclibRecord[], q: LyricsQuery): LrclibRecord | undefined {
  let best: { record: LrclibRecord; score: number; synced: boolean } | undefined;
  for (const record of records) {
    const r = compare(
      { title: q.title, artists: q.artists, durationMs: q.durationMs },
      { title: record.trackName, artists: [record.artistName], durationMs: record.duration ? record.duration * 1000 : undefined },
    );
    if (r.decision !== "match") continue;
    const synced = !!record.syncedLyrics;
    // Prefer synced lyrics, then the closer match.
    if (!best || (synced && !best.synced) || (synced === best.synced && r.score > best.score)) {
      best = { record, score: r.score, synced };
    }
  }
  return best?.record;
}

function toLyrics(record: LrclibRecord): Lyrics | undefined {
  if (record.instrumental) return { sync: "none", lines: [], instrumental: true };
  if (record.syncedLyrics) return parseLrc(record.syncedLyrics);
  if (record.plainLyrics) return parsePlain(record.plainLyrics);
  return undefined;
}
