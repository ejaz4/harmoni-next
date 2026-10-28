import { handle, readJson, SONG_ID } from "@/server/library/http";
import { recentSongs, recordPlay } from "@/server/library/service";
import { withUser } from "@/server/session";

export const GET = withUser((request, user) =>
  handle(async () => {
    const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 50, 200);
    return Response.json(await recentSongs(user.id, limit));
  }),
);

// The player calls this once a song has played long enough to count as a listen.
export const POST = withUser(async (request, user) => {
  const { songId } = await readJson<{ songId: string }>(request);
  if (!songId || !SONG_ID.test(songId)) return Response.json({ error: "Invalid song id" }, { status: 400 });
  return handle(async () => {
    await recordPlay(user.id, songId);
    return new Response(null, { status: 204 });
  });
});
