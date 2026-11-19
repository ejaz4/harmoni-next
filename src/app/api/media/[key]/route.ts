import { readImage } from "@/server/social/media";

// Profile pictures and banners. Public: the names can't be guessed, and
// apps can show them without sending a token. A new picture gets a new
// name, so each can be kept forever.
export async function GET(_request: Request, ctx: RouteContext<"/api/media/[key]">) {
  const image = await readImage((await ctx.params).key);
  if (!image) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(image), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
