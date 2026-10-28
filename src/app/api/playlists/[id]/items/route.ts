import { handle, readJson, SONG_ID } from "@/server/library/http";
import { addToPlaylist } from "@/server/library/service";
import { withUser } from "@/server/session";

export const POST = withUser(async (request, user, ctx: RouteContext<"/api/playlists/[id]/items">) => {
  const { songId } = await readJson<{ songId: string }>(request);
  if (!songId || !SONG_ID.test(songId)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  return handle(async () => {
    const item = await addToPlaylist(user.id, (await ctx.params).id, songId);
    return Response.json({ itemId: item.id }, { status: 201 });
  });
});
