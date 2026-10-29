import { deleteSpice, getSpicePage, renameSpice } from "@/server/discovery/spice";
import { handle, readJson } from "@/server/library/http";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/spices/[id]">;

// Opening a Spice (or playing from it) is what remakes it, once a day.
export const GET = withUser<Ctx>(async (_request, user, { params }) => {
  const { id } = await params;
  return handle(async () => Response.json(await getSpicePage(id, user)));
});

export const PATCH = withUser<Ctx>(async (request, user, { params }) => {
  const { id } = await params;
  const name = (await readJson<{ name: string }>(request)).name?.trim();
  if (!name) return Response.json({ error: "Give the Spice a name." }, { status: 400 });
  return handle(async () => {
    await renameSpice(user.id, id, name.slice(0, 60));
    return new Response(null, { status: 204 });
  });
});

export const DELETE = withUser<Ctx>(async (_request, user, { params }) => {
  const { id } = await params;
  return handle(async () => {
    await deleteSpice(user.id, id);
    return new Response(null, { status: 204 });
  });
});
