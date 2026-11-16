import { deleteGrant } from "@/server/oauth";
import { withWebSession } from "@/server/session";

// Disconnects an app: its tokens stop working at once.
export const DELETE = withWebSession(async (_request, user, ctx: RouteContext<"/api/me/apps/[id]">) => {
  const { id } = await ctx.params;
  if (!(await deleteGrant(user.id, id))) return Response.json({ error: "That app isn't connected." }, { status: 404 });
  return new Response(null, { status: 204 });
});
