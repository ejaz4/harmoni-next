import { handle, SONG_ID } from "@/server/library/http";
import { getSong } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser(async (_request, _user, ctx: RouteContext<"/api/songs/[id]">) => {
  const { id } = await ctx.params;
  if (!SONG_ID.test(id)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  return handle(async () => Response.json(await getSong(id)));
});
