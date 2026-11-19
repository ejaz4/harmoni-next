import { dailyPlaylist } from "@/server/discovery/spice";
import { handle, readJson } from "@/server/library/http";
import { deletePlaylist, getPlaylist, updatePlaylist } from "@/server/library/service";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/playlists/[id]">;

// Their Daily Spice opens as a playlist too (see GET /api/playlists).
export const GET = withUser((_request, user, ctx: Ctx) =>
  handle(async () => {
    const { id } = await ctx.params;
    return Response.json((await dailyPlaylist(user, id)) ?? (await getPlaylist(user.id, id)));
  }),
);

export const PATCH = withUser((request, user, ctx: Ctx) =>
  handle(async () => {
    const body = await readJson<{ name: string; description: string | null }>(request);
    const name = body.name?.trim();
    if (body.name !== undefined && !name) return Response.json({ error: "Give the playlist a name." }, { status: 400 });
    const updated = await updatePlaylist(user.id, (await ctx.params).id, {
      ...(name && { name: name.slice(0, 100) }),
      ...(body.description !== undefined && { description: body.description?.trim().slice(0, 500) || null }),
    });
    return Response.json({ id: updated.id, name: updated.name, description: updated.description });
  }),
);

export const DELETE = withUser((_request, user, ctx: Ctx) =>
  handle(async () => {
    await deletePlaylist(user.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  }),
);
