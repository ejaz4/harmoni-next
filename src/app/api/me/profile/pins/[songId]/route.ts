import { handle, SONG_ID } from "@/server/library/http";
import { setPinned } from "@/server/social/profile";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/me/profile/pins/[songId]">;

// Songs on display on their profile. PUT adds one at the end.
async function pin(user: { id: string }, ctx: Ctx, on: boolean) {
  const { songId } = await ctx.params;
  if (!SONG_ID.test(songId)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  return handle(async () => Response.json({ pinned: await setPinned(user.id, songId, on) }));
}

export const PUT = withUser((_request, user, ctx: Ctx) => pin(user, ctx, true));
export const DELETE = withUser((_request, user, ctx: Ctx) => pin(user, ctx, false));
