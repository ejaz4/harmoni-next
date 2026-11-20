import { Innertube } from "youtubei.js";
import { parsePlain } from "../lyrics/lrc";
import { normalizeText } from "../matching/normalize";
import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import { HttpStatusError, rangedStream } from "./http";
import type { ArtistProfile, AudioStream, ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "ytm";
const FRESH_URL_RETRIES = 3; // waits 0.5 + 1 + 1.5 = 3s at most
const MAX_AD_WAIT_MS = 15_000;

interface ResolvedAudio {
  url: string;
  ext: string;
  mimeType: string;
  headers: Record<string, string>;
  availableAt?: number | null; // unix seconds; set when YouTube runs an ad first
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
        return items.flatMap((item) => toCandidate(item) ?? []).slice(0, limit);
      },
      // YouTube Music indexes ISRCs: searching one puts that recording first,
      // even compilation tracks that text search buries. The rest is filler.
      async searchByIsrc(isrc) {
        const [top] = await this.searchSongs(isrc, 1);
        return top ? [top] : [];
      },
    },
    // Plain-text lyrics (licensed from LyricFind) for songs we have a YouTube Music copy of.
    lyrics: {
      async getLyrics(q) {
        const videoId = q.sources.find((s) => s.provider === PREFIX)?.externalId;
        if (!videoId) return undefined;
        const yt = await getClient();
        let shelf;
        try {
          shelf = await yt.music.getLyrics(videoId);
        } catch {
          return undefined; // youtubei.js throws when a song has no lyrics
        }
        const text = shelf?.description?.toString();
        return text ? parsePlain(text) : undefined;
      },
    },
    // Bio, wide banner and playable top songs; Deezer handles the discography.
    artist: {
      async findArtist(name) {
        const yt = await getClient();
        const res = await yt.music.search(name, { type: "artist" }).catch((err) => {
          throw new ProviderError("Unavailable", PREFIX, "artist search failed", { cause: err });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
        const items: any[] = (res as any).artists?.contents ?? [];
        const match = items.find((a) => a?.id && normalizeText(a.name ?? "") === normalizeText(name));
        return match ? { name: match.name, source: formatSource(PREFIX, match.id) } : undefined;
      },

      async getArtist(channelId): Promise<ArtistProfile> {
        const yt = await getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
        const page: any = await yt.music.getArtist(channelId).catch((err) => {
          throw new ProviderError("Unavailable", PREFIX, "artist page failed", { cause: err });
        });
        const header = page.header;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
        const sections: any[] = page.sections ?? [];
        const titled = (t: string) => sections.find((x) => (x.header?.title?.toString?.() ?? x.title?.toString?.() ?? "") === t);
        const thumbs = header?.thumbnail?.contents ?? [];
        return {
          source: formatSource(PREFIX, channelId),
          name: header?.title?.toString?.() ?? "",
          bannerUrl: upscaleBanner(thumbs.at(-1)?.url),
          bio: header?.description?.toString?.() || undefined,
          topTracks: (titled("Top songs")?.contents ?? []).flatMap((item: unknown) => toCandidate(item) ?? []),
          releases: [],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
          related: (titled("Fans might also like")?.contents ?? []).flatMap((a: any) =>
            a?.id && a.title ? [{ name: a.title.toString(), source: formatSource(PREFIX, a.id), imageUrl: upscaleThumbnail(a.thumbnail?.[0]?.url ?? a.thumbnail?.contents?.[0]?.url) }] : [],
          ),
        };
      },
    },
    // The "up next" radio YouTube Music builds when you play a song.
    discovery: {
      async similarSongs(seed) {
        const videoId = seed.sources.find((s) => s.provider === PREFIX)?.externalId;
        if (!videoId) return [];
        const yt = await getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
        const panel: any = await yt.music.getUpNext(videoId, true).catch((err) => {
          throw new ProviderError("Unavailable", PREFIX, "up next failed", { cause: err });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
        const items: any[] = panel?.contents ?? [];
        // Panel rows name things differently from search rows: video_id, a Text title, a bare thumbnail list.
        return items.flatMap((item) =>
          item?.video_id && item.video_id !== videoId
            ? (toCandidate({ ...item, id: item.video_id, title: item.title?.toString(), thumbnail: { contents: item.thumbnail } }) ?? [])
            : [],
        );
      },
    },
    song: {
      cacheable: true,
      // A URL the sidecar cached can die for good. A 403 that outlasts the
      // wait gets one fresh URL before giving up.
      async resolveStream(externalId, start = 0): Promise<AudioStream> {
        for (const fresh of [false, true]) {
          const audio = await resolveAudio(ytdlpUrl, externalId, fresh);
          try {
            const stream = await fetchAudio(audio, start);
            return { body: stream.body, mimeType: audio.mimeType, ext: audio.ext, start: stream.start, totalLength: stream.total };
          } catch (err) {
            const forbidden = err instanceof HttpStatusError && err.status === 403;
            if (forbidden && !fresh) continue;
            throw new ProviderError("Unavailable", PREFIX, "audio fetch failed", { cause: err });
          }
        }
        throw new ProviderError("Unavailable", PREFIX, "audio fetch failed");
      },
    },
  };
}

async function resolveAudio(ytdlpUrl: string, externalId: string, fresh: boolean): Promise<ResolvedAudio> {
  let res: Response;
  try {
    res = await fetch(`${ytdlpUrl}/resolve?id=${encodeURIComponent(externalId)}${fresh ? "&fresh=1" : ""}`);
  } catch (err) {
    throw new ProviderError("Unavailable", PREFIX, "yt-dlp sidecar unreachable", { cause: err });
  }
  if (res.status === 404) throw new ProviderError("NotFound", PREFIX, `${externalId} is unavailable`);
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ProviderError("Unavailable", PREFIX, detail.error ?? `sidecar HTTP ${res.status}`);
  }
  return (await res.json()) as ResolvedAudio;
}

// When YouTube puts an ad before a song, its audio answers 403 until the ad
// could have been skipped (usually 5 s). Wait that out, then allow a few
// short retries, since googlevideo's clock and ours don't quite agree.
async function fetchAudio(audio: ResolvedAudio, start: number) {
  const wait = audio.availableAt ? audio.availableAt * 1000 - Date.now() : 0;
  if (wait > 0) await sleep(Math.min(wait, MAX_AD_WAIT_MS));
  for (let attempt = 0; ; attempt++) {
    try {
      return await rangedStream(audio.url, audio.headers, start);
    } catch (err) {
      if (!(err instanceof HttpStatusError && err.status === 403) || attempt >= FRESH_URL_RETRIES) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A song row (search result or artist "Top songs") as a candidate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- youtubei.js node types are loose
function toCandidate(item: any): SongCandidate | undefined {
  if (!item?.id || !item.title) return undefined;
  return {
    source: formatSource(PREFIX, item.id),
    title: item.title,
    artists: (item.artists ?? []).map((a: { name: string; channel_id?: string }) => ({
      name: a.name,
      source: a.channel_id ? formatSource(PREFIX, a.channel_id) : undefined,
    })),
    album: item.album?.name
      ? { name: item.album.name, source: item.album.id ? formatSource(PREFIX, item.album.id) : undefined }
      : undefined,
    durationMs: item.duration?.seconds ? item.duration.seconds * 1000 : undefined,
    explicit: item.badges?.some((b: { label?: string }) => b.label === "Explicit") ?? false,
    artworkUrl: upscaleThumbnail(item.thumbnail?.contents?.[0]?.url),
  };
}

// Wide artist banners come back at 540x225; the same URL serves larger.
function upscaleBanner(url: string | undefined): string | undefined {
  return url?.replace(/=w\d+-h\d+/, "=w2160-h900");
}

// Search thumbnails come back at 120px; the same URL serves larger sizes.
function upscaleThumbnail(url: string | undefined): string | undefined {
  return url?.replace(/=w\d+-h\d+/, "=w544-h544");
}
