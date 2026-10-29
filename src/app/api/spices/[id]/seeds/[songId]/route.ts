import { removeSeed } from "@/server/discovery/spice";
import { handle } from "@/server/library/http";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/spices/[id]/seeds/[songId]">;

export const DELETE = withUser<Ctx>(async (_request, user, { params }) => {
  const { id, songId } = await params;
  return handle(async () => {
    await removeSeed(user.id, id, songId);
    return new Response(null, { status: 204 });
  });
});
