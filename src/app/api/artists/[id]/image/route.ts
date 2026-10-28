import { db } from "@/server/db";
import { withUser } from "@/server/session";

// Serves an artist's photo from our own origin so the page can read its
// colours, like song artwork. Only the stored URL is fetched.
export const GET = withUser(async (_request, _user, ctx: RouteContext<"/api/artists/[id]/image">) => {
  const { id } = await ctx.params;
  const artist = await db.artist.findUnique({ where: { id }, select: { imageUrl: true } });
  if (!artist?.imageUrl) return new Response(null, { status: 404 });
  const upstream = await fetch(artist.imageUrl).catch(() => undefined);
  const type = upstream?.headers.get("content-type") ?? "";
  if (!upstream?.ok || !type.startsWith("image/")) return new Response(null, { status: 502 });
  return new Response(upstream.body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800" } });
});
