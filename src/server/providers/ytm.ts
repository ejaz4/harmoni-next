import { Innertube } from "youtubei.js";
import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "ytm";

export function ytm(): ProviderPlugin {
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
    },
  };
}

// Search thumbnails come back at 120px; the same URL serves larger sizes.
function upscaleThumbnail(url: string | undefined): string | undefined {
  return url?.replace(/=w\d+-h\d+/, "=w544-h544");
}
