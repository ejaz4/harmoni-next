import { readJson, SONG_ID } from "@/server/library/http";
import { autoplaySongs } from "@/server/discovery/autoplay";
import { withUser } from "@/server/session";

// More songs for when the queue runs out. `seeds` are the current song and
// the ones before it, latest first; `exclude` is what's already queued.
export const POST = withUser(async (request, user) => {
  const body = await readJson<{ seeds: string[]; exclude: string[] }>(request);
  const ids = (list: unknown, max: number) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string" && SONG_ID.test(id)).slice(0, max) : []);
  const seeds = ids(body.seeds, 3);
  if (!seeds.length) return Response.json({ error: "Nothing to go on." }, { status: 400 });
  const songs = await autoplaySongs(user, seeds, new Set(ids(body.exclude, 500)));
  return Response.json(songs);
});
