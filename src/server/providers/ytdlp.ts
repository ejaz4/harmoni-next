import { ProviderError } from "./errors";
import type { AudioStream, ProviderPlugin } from "./types";

const PREFIX = "ytdlp";

// The fallback for YouTube Music songs: yt-dlp downloads the whole song
// itself (waiting out ads, retrying, keeping up with YouTube's changes) and
// the sidecar (services/ytdlp) hands the file over. Slower to start than
// YouTube Music's direct stream, so it's tried after it.
export function ytdlp(ytdlpUrl: string): ProviderPlugin {
  return {
    prefix: PREFIX,
    name: "yt-dlp",
    song: {
      plays: ["ytm"],
      cacheable: true,
      async resolveStream(videoId, start = 0): Promise<AudioStream> {
        let res: Response;
        try {
          res = await fetch(`${ytdlpUrl}/download?id=${encodeURIComponent(videoId)}`, {
            headers: start ? { Range: `bytes=${start}-` } : {},
          });
        } catch (err) {
          throw new ProviderError("Unavailable", PREFIX, "yt-dlp sidecar unreachable", { cause: err });
        }
        if (res.status === 404) throw new ProviderError("NotFound", PREFIX, `${videoId} is unavailable`);
        if ((res.status !== 200 && res.status !== 206) || !res.body) {
          const detail = (await res.json().catch(() => ({}))) as { error?: string };
          throw new ProviderError("Unavailable", PREFIX, detail.error ?? `sidecar HTTP ${res.status}`);
        }
        const partial = res.status === 206;
        const total = partial ? Number(res.headers.get("content-range")?.split("/")[1]) : Number(res.headers.get("content-length"));
        return {
          body: res.body,
          mimeType: res.headers.get("content-type") ?? "audio/mp4",
          ext: res.headers.get("x-ext") ?? "m4a",
          start: partial ? start : 0,
          totalLength: total || undefined,
        };
      },
    },
  };
}
