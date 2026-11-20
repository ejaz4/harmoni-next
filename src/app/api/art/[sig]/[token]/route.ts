import { getArt, nearestSize, verifyArt } from "@/server/artwork";

// A cover or photo, through Harmoni (see src/server/artwork.ts). Public:
// the signature in the path is the permission. `?w=` picks a smaller copy.
export async function GET(request: Request, ctx: RouteContext<"/api/art/[sig]/[token]">) {
  const { sig, token } = await ctx.params;
  const url = verifyArt(sig, token);
  if (!url) return new Response(null, { status: 404 });
  const width = nearestSize(Number(new URL(request.url).searchParams.get("w")) || undefined);
  const image = await getArt(url, width);
  if (!image) return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(image.body), {
    headers: {
      "Content-Type": image.type,
      "Content-Length": String(image.body.length),
      // The path names the image for good, so it never needs checking again.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
