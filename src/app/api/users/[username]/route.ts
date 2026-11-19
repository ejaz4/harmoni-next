import { handle } from "@/server/library/http";
import { getProfile } from "@/server/social/profile";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user, ctx: RouteContext<"/api/users/[username]">) =>
  handle(async () => Response.json(await getProfile((await ctx.params).username, user.id))),
);
