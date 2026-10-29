import { addSeed } from "@/server/discovery/spice";
import { handle, readJson, SONG_ID } from "@/server/library/http";
import { withUser } from "@/server/session";

type Ctx = RouteContext<"/api/spices/[id]/seeds">;

export const POST = withUser<Ctx>(async (request, user, { params }) => {
  const { id } = await params;
  const { songId } = await readJson<{ songId: string }>(request);
  if (!songId || !SONG_ID.test(songId)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  return handle(async () => {
    await addSeed(user.id, id, songId);
    return new Response(null, { status: 204 });
  });
});
