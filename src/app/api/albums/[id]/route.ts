import { handle } from "@/server/library/http";
import { getAlbum } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser((_request, _user, ctx: RouteContext<"/api/albums/[id]">) =>
  handle(async () => Response.json(await getAlbum((await ctx.params).id))),
);
