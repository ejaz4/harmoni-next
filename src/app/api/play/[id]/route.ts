import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import type { CacheEntry } from "@/server/playback/cache";
import { PlaybackError, resolvePlayback } from "@/server/playback/resolver";

const SONG_ID = /^[0-9a-f-]{36}$/;

export async function GET(request: NextRequest, ctx: RouteContext<"/api/play/[id]">) {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });

  try {
    const playback = await resolvePlayback(id);
    if (playback.kind === "cached") {
      return serveFile(request, playback.entry);
    }
    // First play streams straight from the provider while it's being cached,
    // so seeking only works once the song is cached.
    return new Response(playback.body, {
      headers: {
        "Content-Type": playback.mimeType,
        ...(playback.contentLength && { "Content-Length": String(playback.contentLength) }),
        "Accept-Ranges": "none",
        "Cache-Control": "no-store",
        "X-Harmoni-Source": playback.source,
      },
    });
  } catch (err) {
    if (err instanceof PlaybackError) {
      return Response.json(
        { error: err.message, attempts: err.attempts },
        { status: err.kind === "NotFound" ? 404 : 502 },
      );
    }
    throw err;
  }
}

function serveFile(request: NextRequest, entry: CacheEntry): Response {
  const headers: Record<string, string> = {
    "Content-Type": entry.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Harmoni-Source": `cache (${entry.source})`,
  };
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range || (!range[1] && !range[2])) {
    return new Response(toWeb(entry.file), { headers: { ...headers, "Content-Length": String(entry.size) } });
  }

  // "bytes=-500" means the last 500 bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, entry.size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), entry.size - 1) : entry.size - 1;
  if (start > end || start >= entry.size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${entry.size}` } });
  }
  return new Response(toWeb(entry.file, start, end), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${entry.size}`,
    },
  });
}

function toWeb(file: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  // node:stream/web and DOM ReadableStream types differ but are the same object at runtime.
  return Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
}
