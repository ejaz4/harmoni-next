import { handle, readJson } from "@/server/library/http";
import { createPlaylist, listPlaylists } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser((_request, user) => handle(async () => Response.json(await listPlaylists(user.id))));

export const POST = withUser(async (request, user) => {
  const { name, description } = await readJson<{ name: string; description: string }>(request);
  const trimmed = name?.trim();
  if (!trimmed) return Response.json({ error: "Give the playlist a name." }, { status: 400 });
  const playlist = await createPlaylist(user.id, trimmed.slice(0, 100), description?.trim().slice(0, 500) || undefined);
  return Response.json({ id: playlist.id, name: playlist.name }, { status: 201 });
});
