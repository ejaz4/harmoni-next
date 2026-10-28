import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { CacheEntry } from "@/server/playback/cache";
import { PlaybackError, resolvePlayback, type Playback } from "@/server/playback/resolver";
import { withUser } from "@/server/session";

const SONG_ID = /^[0-9a-f-]{36}$/;

interface ByteRange {
  start?: number; // undefined for a suffix range ("bytes=-500")
  end?: number;
  suffix?: number;
}

export const GET = withUser(async (request, _user, ctx: RouteContext<"/api/play/[id]">) => {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  const range = parseRange(request.headers.get("range"));

  try {
    const playback = await resolvePlayback(id, range?.start ?? 0);
    return playback.kind === "cached" ? serveFile(entryRange(range, playback.entry.size), playback.entry) : serveStream(range, playback);
  } catch (err) {
    if (err instanceof PlaybackError) {
      return Response.json(
        { error: err.message, attempts: err.attempts },
        { status: err.kind === "NotFound" ? 404 : 502 },
      );
    }
    throw err;
  }
});

function parseRange(header: string | null): ByteRange | undefined {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return undefined;
  if (!m[1]) return { suffix: Number(m[2]) };
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined };
}

// Resolves a requested range against a known size; undefined = whole file.
function entryRange(range: ByteRange | undefined, size: number) {
  if (!range) return undefined;
  const start = range.suffix !== undefined ? Math.max(0, size - range.suffix) : range.start!;
  const end = Math.min(range.end ?? size - 1, size - 1);
  return { start, end };
}

function serveFile(range: { start: number; end: number } | undefined, entry: CacheEntry): Response {
  const headers: Record<string, string> = {
    "Content-Type": entry.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Harmoni-Source": `cache (${entry.source})`,
  };
  if (!range) {
    return new Response(fileStream(entry.file), { headers: { ...headers, "Content-Length": String(entry.size) } });
  }
  if (range.start > range.end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${entry.size}` } });
  }
  return new Response(fileStream(entry.file, range.start, range.end), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${entry.size}`,
    },
  });
}

// Uncached songs stream from the provider, which fetches from the requested
// offset, so the player can seek before the song has finished caching.
function serveStream(range: ByteRange | undefined, playback: Extract<Playback, { kind: "stream" }>): Response {
  const headers: Record<string, string> = {
    "Content-Type": playback.mimeType,
    "Cache-Control": "no-store",
    "X-Harmoni-Source": playback.source,
  };
  const total = playback.totalLength;
  if (total === undefined) {
    return new Response(playback.body, { headers: { ...headers, "Accept-Ranges": "none" } });
  }
  headers["Accept-Ranges"] = "bytes";

  // No range asked for, or the provider couldn't honour it: send it all.
  if (!range || range.start === undefined || playback.start !== range.start) {
    return new Response(playback.body, { headers: { ...headers, "Content-Length": String(total - playback.start) } });
  }
  if (range.start >= total) {
    void playback.body.cancel();
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  }
  const end = Math.min(range.end ?? total - 1, total - 1);
  const length = end - range.start + 1;
  const body = end < total - 1 ? limitBytes(playback.body, length) : playback.body;
  return new Response(body, {
    status: 206,
    headers: { ...headers, "Content-Length": String(length), "Content-Range": `bytes ${range.start}-${end}/${total}` },
  });
}

function limitBytes(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const remaining = limit - sent;
        if (remaining <= 0) return;
        controller.enqueue(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
        sent += Math.min(chunk.byteLength, remaining);
        if (sent >= limit) controller.terminate();
      },
    }),
  );
}

function fileStream(file: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  // node:stream/web and DOM ReadableStream types differ but are the same object at runtime.
  return Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
}
