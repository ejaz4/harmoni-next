import { handle } from "@/server/library/http";
import { followList } from "@/server/social/profile";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user, ctx: RouteContext<"/api/users/[username]/followers">) =>
  handle(async () => Response.json(await followList((await ctx.params).username, "followers", user.id))),
);
