import { handle } from "@/server/library/http";
import { MAX_UPLOAD_BYTES } from "@/server/social/media";
import { setImage } from "@/server/social/profile";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/me/profile/[image]">;
const kindOf = (image: string) => (image === "avatar" || image === "banner" ? image : null);

// The picture itself is the body (any image type); it's cropped and resized here.
export const PUT = withUser(async (request, user, ctx: Ctx) => {
  const kind = kindOf((await ctx.params).image);
  if (!kind) return Response.json({ error: "Not found." }, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) return Response.json({ error: "That picture is too big: 10 MB at most." }, { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) return Response.json({ error: "Send the picture as the request body." }, { status: 400 });
  return handle(async () => Response.json({ url: await setImage(user.id, kind, bytes) }));
});

export const DELETE = withUser(async (_request, user, ctx: Ctx) => {
  const kind = kindOf((await ctx.params).image);
  if (!kind) return Response.json({ error: "Not found." }, { status: 404 });
  await setImage(user.id, kind, null);
  return new Response(null, { status: 204 });
});
