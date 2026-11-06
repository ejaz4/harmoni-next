import { createSpice, listSpices, MAX_SEEDS } from "@/server/discovery/spice";
import { handle, readJson, SONG_ID } from "@/server/library/http";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user) => handle(async () => Response.json(await listSpices(user.id))));

// A new Spice of your own, from the songs picked as its seeds. Without a
// name, it's named after them.
export const POST = withUser(async (request, user) => {
  const { name, seedIds = [] } = await readJson<{ name: string; seedIds: string[] }>(request);
  if (!Array.isArray(seedIds) || seedIds.length > MAX_SEEDS || !seedIds.every((id) => typeof id === "string" && SONG_ID.test(id)))
    return Response.json({ error: "Invalid seed songs" }, { status: 400 });
  const trimmed = typeof name === "string" ? name.trim().slice(0, 60) : "";
  return handle(async () => Response.json(await createSpice(user.id, { name: trimmed || undefined, seedIds }), { status: 201 }));
});
