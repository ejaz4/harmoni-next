import { handle } from "@/server/library/http";
import { likedIds, likedSongs } from "@/server/library/service";
import { withUser } from "@/server/session";

// ?ids=1 returns just the liked song ids (for heart icons); otherwise the songs.
export const GET = withUser((request, user) =>
  handle(async () => {
    const idsOnly = new URL(request.url).searchParams.get("ids") === "1";
    return Response.json(idsOnly ? await likedIds(user.id) : await likedSongs(user.id));
  }),
);
