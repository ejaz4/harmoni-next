import { handle, SONG_ID } from "@/server/library/http";
import { setLiked } from "@/server/library/service";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/likes/[songId]">;

const toggle = (liked: boolean) =>
  withUser(async (_request, user, ctx: Ctx) => {
    const { songId } = await ctx.params;
    if (!SONG_ID.test(songId)) return Response.json({ error: "Invalid song id" }, { status: 400 });
    return handle(async () => Response.json({ songId: await setLiked(user.id, songId, liked), liked }));
  });

export const PUT = toggle(true);
export const DELETE = toggle(false);
