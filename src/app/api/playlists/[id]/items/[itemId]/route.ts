import { handle } from "@/server/library/http";
import { removeFromPlaylist } from "@/server/library/service";
import { withUser } from "@/server/session";

export const DELETE = withUser((_request, user, ctx: RouteContext<"/api/playlists/[id]/items/[itemId]">) =>
  handle(async () => {
    const { id, itemId } = await ctx.params;
    await removeFromPlaylist(user.id, id, itemId);
    return new Response(null, { status: 204 });
  }),
);
