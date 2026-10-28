import { Innertube } from "youtubei.js";
import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import { HttpStatusError, rangedStream } from "./http";
import type { AudioStream, ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "ytm";
const FRESH_URL_RETRIES = 4; // waits 0.5 + 1 + 1.5 + 2 = 5s at most

interface ResolvedAudio {
  url: string;
  ext: string;
  mimeType: string;
  headers: Record<string, string>;
}

// Search goes through youtubei.js; audio goes through the yt-dlp sidecar
// (services/ytdlp), which keeps up with YouTube's changes far better.
export function ytm(ytdlpUrl: string): ProviderPlugin {
  let client: Promise<Innertube> | undefined;

  const getClient = () => {
    client ??= Innertube.create({ retrieve_player: false }).catch((err) => {
      client = undefined; // retry on next call instead of caching the failure
      throw new ProviderError("Unavailable", PREFIX, "could not start Innertube", { cause: err });
    });
    return client;
  };

  return {
    prefix: PREFIX,
    name: "YouTube Music",
    metadataPriority: 30,
    search: {
      async searchSongs(query, limit) {
        const yt = await getClient();
        let res;
        try {
          res = await yt.music.search(query, { type: "song" });
        } catch (err) {
          throw new ProviderError("Unavailable", PREFIX, "search failed", { cause: err });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
        const items: any[] = res.songs?.contents ?? [];
        const songs: SongCandidate[] = [];
        for (const item of items) {
          if (!item.id || !item.title) continue;
          songs.push({
            source: formatSource(PREFIX, item.id),
            title: item.title,
            artists: (item.artists ?? []).map((a: { name: string; channel_id?: string }) => ({
              name: a.name,
              source: a.channel_id ? formatSource(PREFIX, a.channel_id) : undefined,
            })),
            album: item.album?.name
              ? {
                  name: item.album.name,
                  source: item.album.id ? formatSource(PREFIX, item.album.id) : undefined,
                }
              : undefined,
            durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : undefined,
            explicit: item.badges?.some((b: { label?: string }) => b.label === "Explicit") ?? false,
            artworkUrl: upscaleThumbnail(item.thumbnail?.contents?.[0]?.url),
          });
          if (songs.length >= limit) break;
        }
        return songs;
      },
      // YouTube Music indexes ISRCs: searching one puts that recording first,
      // even compilation tracks that text search buries. The rest is filler.
      async searchByIsrc(isrc) {
        const [top] = await this.searchSongs(isrc, 1);
        return top ? [top] : [];
      },
    },
    song: {
      cacheable: true,
      async resolveStream(externalId, start = 0): Promise<AudioStream> {
        let res: Response;
        try {
          res = await fetch(`${ytdlpUrl}/resolve?id=${encodeURIComponent(externalId)}`);
        } catch (err) {
          throw new ProviderError("Unavailable", PREFIX, "yt-dlp sidecar unreachable", { cause: err });
        }
        if (res.status === 404) throw new ProviderError("NotFound", PREFIX, `${externalId} is unavailable`);
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new ProviderError("Unavailable", PREFIX, detail.error ?? `sidecar HTTP ${res.status}`);
        }
        const audio = (await res.json()) as ResolvedAudio;
        // Freshly resolved googlevideo URLs answer 403 for the first second or two.
        for (let attempt = 0; ; attempt++) {
          try {
            const stream = await rangedStream(audio.url, audio.headers, start);
            return { body: stream.body, mimeType: audio.mimeType, ext: audio.ext, start: stream.start, totalLength: stream.total };
          } catch (err) {
            if (err instanceof HttpStatusError && err.status === 403 && attempt < FRESH_URL_RETRIES) {
              await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
              continue;
            }
            throw new ProviderError("Unavailable", PREFIX, "audio fetch failed", { cause: err });
          }
        }
      },
    },
  };
}

// Search thumbnails come back at 120px; the same URL serves larger sizes.
function upscaleThumbnail(url: string | undefined): string | undefined {
  return url?.replace(/=w\d+-h\d+/, "=w544-h544");
}
