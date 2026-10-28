import { getArtistPage } from "@/server/library/catalogue";
import { handle } from "@/server/library/http";
import { withUser } from "@/server/session";

// The first visit to an artist builds their catalogue from providers (a few
// seconds); after that it's served from cache and refreshed in the background.
export const GET = withUser((_request, user, ctx: RouteContext<"/api/artists/[id]">) =>
  handle(async () => Response.json(await getArtistPage((await ctx.params).id, user.id))),
);
