import { dailyPlaylistSummary } from "@/server/discovery/spice";
import { handle, readJson } from "@/server/library/http";
import { createPlaylist, listPlaylists } from "@/server/library/service";
import { withUser } from "@/server/session";

// Their Daily Spice comes first (with Super Processing on), so apps that
// don't know about it still show it at the top. Apps that give it a place
// of its own ask with `?daily=false`.
export const GET = withUser((request, user) =>
  handle(async () => {
    const daily = user.superProcessing && new URL(request.url).searchParams.get("daily") !== "false";
    const [first, playlists] = await Promise.all([daily ? dailyPlaylistSummary(user).then((p) => [p]) : [], listPlaylists(user.id)]);
    return Response.json([...first, ...playlists]);
  }),
);

export const POST = withUser(async (request, user) => {
  const { name, description } = await readJson<{ name: string; description: string }>(request);
  const trimmed = name?.trim();
  if (!trimmed) return Response.json({ error: "Give the playlist a name." }, { status: 400 });
  const playlist = await createPlaylist(user.id, trimmed.slice(0, 100), description?.trim().slice(0, 500) || undefined);
  return Response.json({ id: playlist.id, name: playlist.name }, { status: 201 });
});
