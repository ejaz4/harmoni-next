import { handle } from "@/server/library/http";
import { getArtist } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user, ctx: RouteContext<"/api/artists/[id]">) =>
  handle(async () => Response.json(await getArtist((await ctx.params).id, user.id))),
);
