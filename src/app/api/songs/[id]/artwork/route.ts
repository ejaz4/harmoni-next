import { getArt, nearestSize } from "@/server/artwork";
import { db } from "@/server/db";
import { SONG_ID } from "@/server/library/http";
import { persistQueue } from "@/server/search/persist-queue";
import { withUser } from "@/server/session";

// A song's cover by its id, through the artwork cache (see
// src/server/artwork.ts). `?w=` picks a smaller copy. Only the URL stored
// for the song is fetched, never one from the request.
export const GET = withUser(async (request, _user, ctx: RouteContext<"/api/songs/[id]/artwork">) => {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  const songId = await persistQueue.settled(id);
  const song = await db.song.findUnique({ where: { id: songId }, select: { artworkUrl: true } });
  if (!song?.artworkUrl) return new Response(null, { status: 404 });
  const image = await getArt(song.artworkUrl, nearestSize(Number(new URL(request.url).searchParams.get("w")) || undefined));
  if (!image) return new Response(null, { status: 502 });
  return new Response(new Uint8Array(image.body), {
    headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=604800, immutable" },
  });
});
