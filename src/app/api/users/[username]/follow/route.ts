import { handle } from "@/server/library/http";
import { follow } from "@/server/social/profile";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/users/[username]/follow">;

// Following is one way and needs no say-so: they can follow back.
export const PUT = withUser((_request, user, ctx: Ctx) => handle(async () => Response.json(await follow(user.id, (await ctx.params).username, true))));
export const DELETE = withUser((_request, user, ctx: Ctx) => handle(async () => Response.json(await follow(user.id, (await ctx.params).username, false))));
