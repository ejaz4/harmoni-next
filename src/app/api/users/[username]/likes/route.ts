import { handle } from "@/server/library/http";
import { profileLikes } from "@/server/social/profile";
import { withUser } from "@/server/session";

// All their liked songs, if they show them on their profile.
export const GET = withUser((_request, user, ctx: RouteContext<"/api/users/[username]/likes">) =>
  handle(async () => Response.json(await profileLikes((await ctx.params).username, user.id))),
);
