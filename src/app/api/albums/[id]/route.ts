import { getAlbumPage } from "@/server/library/catalogue";
import { handle } from "@/server/library/http";
import { withUser } from "@/server/session";

export const GET = withUser((_request, _user, ctx: RouteContext<"/api/albums/[id]">) =>
  handle(async () => Response.json(await getAlbumPage((await ctx.params).id))),
);
