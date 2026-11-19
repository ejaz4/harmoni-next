import { handle, readJson } from "@/server/library/http";
import { deletePlaylist, updatePlaylist } from "@/server/library/service";
import { setVisibility, viewPlaylist } from "@/server/social/sharing";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/playlists/[id]">;

// Theirs, or someone else's they can open: public, shared with them, or
// with `?key=` from a share link.
export const GET = withUser((request, user, ctx: Ctx) =>
  handle(async () => Response.json(await viewPlaylist(user.id, (await ctx.params).id, new URL(request.url).searchParams.get("key")))),
);

export const PATCH = withUser((request, user, ctx: Ctx) =>
  handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ name: string; description: string | null; visibility: string; resetLink: boolean }>(request);
    const name = body.name?.trim();
    if (body.name !== undefined && !name) return Response.json({ error: "Give the playlist a name." }, { status: 400 });
    const sharing = body.visibility !== undefined || body.resetLink ? await setVisibility(user.id, id, body.visibility, body.resetLink === true) : undefined;
    const updated = await updatePlaylist(user.id, id, {
      ...(name && { name: name.slice(0, 100) }),
      ...(body.description !== undefined && { description: body.description?.trim().slice(0, 500) || null }),
    });
    return Response.json({ id: updated.id, name: updated.name, description: updated.description, ...(sharing ?? { visibility: updated.visibility }) });
  }),
);

export const DELETE = withUser((_request, user, ctx: Ctx) =>
  handle(async () => {
    await deletePlaylist(user.id, (await ctx.params).id);
    return new Response(null, { status: 204 });
  }),
);
