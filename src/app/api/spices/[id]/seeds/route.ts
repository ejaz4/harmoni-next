import { addSeed, MAX_SEEDS, setSeeds } from "@/server/discovery/spice";
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

// Every seed at once, in order: what picking them again saves.
export const PUT = withUser<Ctx>(async (request, user, { params }) => {
  const { id } = await params;
  const { songIds } = await readJson<{ songIds: string[] }>(request);
  if (!Array.isArray(songIds) || !songIds.length || songIds.length > MAX_SEEDS || !songIds.every((s) => typeof s === "string" && SONG_ID.test(s)))
    return Response.json({ error: "Invalid seed songs" }, { status: 400 });
  return handle(async () => {
    await setSeeds(user.id, id, songIds);
    return new Response(null, { status: 204 });
  });
});
