import { handle, readJson } from "@/server/library/http";
import { setShares } from "@/server/social/sharing";
import { withUser } from "@/server/session";

// Everyone it's shared with, replacing the list. Used while visibility is "users".
export const PUT = withUser(async (request, user, ctx: RouteContext<"/api/playlists/[id]/shares">) => {
  const { usernames } = await readJson<{ usernames: string[] }>(request);
  return handle(async () => Response.json(await setShares(user.id, (await ctx.params).id, usernames)));
});
