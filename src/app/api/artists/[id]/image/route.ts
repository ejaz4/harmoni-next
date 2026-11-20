import { getArt, nearestSize } from "@/server/artwork";
import { db } from "@/server/db";
import { withUser } from "@/server/session";

// An artist's photo by their id, through the artwork cache, like song
// covers. `?w=` picks a smaller copy. Only the stored URL is fetched.
export const GET = withUser(async (request, _user, ctx: RouteContext<"/api/artists/[id]/image">) => {
  const { id } = await ctx.params;
  const artist = await db.artist.findUnique({ where: { id }, select: { imageUrl: true } });
  if (!artist?.imageUrl) return new Response(null, { status: 404 });
  const image = await getArt(artist.imageUrl, nearestSize(Number(new URL(request.url).searchParams.get("w")) || undefined));
  if (!image) return new Response(null, { status: 502 });
  return new Response(new Uint8Array(image.body), { headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=604800" } });
});
