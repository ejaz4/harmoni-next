import { db } from "@/server/db";
import { SONG_ID } from "@/server/library/http";
import { persistQueue } from "@/server/search/persist-queue";
import { withUser } from "@/server/session";

// Serves a song's cover from our own origin so the browser can read its
// pixels (to colour the UI from the artwork); third-party CDNs don't allow
// that. Only the URL stored for the song is fetched, never one from the request.
export const GET = withUser(async (_request, _user, ctx: RouteContext<"/api/songs/[id]/artwork">) => {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  const songId = await persistQueue.settled(id);
  const song = await db.song.findUnique({ where: { id: songId }, select: { artworkUrl: true } });
  if (!song?.artworkUrl) return new Response(null, { status: 404 });

  const upstream = await fetch(song.artworkUrl).catch(() => undefined);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) return new Response(null, { status: 502 });
  return new Response(upstream.body, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800, immutable" },
  });
});
