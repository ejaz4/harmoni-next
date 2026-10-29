import { createSpice, listSpices } from "@/server/discovery/spice";
import { handle, readJson, SONG_ID } from "@/server/library/http";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user) => handle(async () => Response.json(await listSpices(user.id))));

// A new Spice of your own, optionally starting from one seed song.
export const POST = withUser(async (request, user) => {
  const { name, seedId } = await readJson<{ name: string; seedId: string }>(request);
  const trimmed = name?.trim();
  if (!trimmed) return Response.json({ error: "Give the Spice a name." }, { status: 400 });
  if (seedId !== undefined && !SONG_ID.test(seedId)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  return handle(async () => Response.json(await createSpice(user.id, trimmed.slice(0, 60), seedId), { status: 201 }));
});
