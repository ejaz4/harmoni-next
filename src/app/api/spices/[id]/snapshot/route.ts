import { snapshotSpice } from "@/server/discovery/spice";
import { handle } from "@/server/library/http";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/spices/[id]/snapshot">;

// Saves today's songs as an ordinary playlist.
export const POST = withUser<Ctx>(async (_request, user, { params }) => {
  const { id } = await params;
  return handle(async () => Response.json(await snapshotSpice(user, id), { status: 201 }));
});
