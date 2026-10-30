import { getSongLyrics } from "@/server/lyrics/service";
import { withUser } from "@/server/session";
import { getServerSettings } from "@/server/settings";

const SONG_ID = /^[0-9a-f-]{36}$/;

export const GET = withUser(async (_request, _user, ctx: RouteContext<"/api/lyrics/[id]">) => {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  if (!(await getServerSettings()).features.lyrics) return Response.json({ songId: id, found: false });
  const lyrics = await getSongLyrics(id);
  if (!lyrics) return Response.json({ error: `No song ${id}` }, { status: 404 });
  return Response.json(lyrics);
});
