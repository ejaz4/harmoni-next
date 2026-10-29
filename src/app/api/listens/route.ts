import { readJson, SONG_ID } from "@/server/library/http";
import { recordListen, type ListenInput } from "@/server/discovery/listens";
import { withUser } from "@/server/session";

const REASONS = new Set<ListenInput["reason"]>(["ended", "skip", "back", "close", "error"]);
const HOUR_MS = 60 * 60_000;
const int = (n: unknown, max: number) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : undefined);

// The player sends one of these (as a beacon) whenever a song stops being
// the current one. Ignored unless the account has Super Processing on.
export const POST = withUser(async (request, user) => {
  if (!user.superProcessing) return new Response(null, { status: 204 });
  const body = await readJson<ListenInput>(request);
  const playedMs = int(body.playedMs, 6 * HOUR_MS);
  const positionMs = int(body.positionMs, 6 * HOUR_MS);
  if (!body.songId || !SONG_ID.test(body.songId) || playedMs === undefined || positionMs === undefined || !REASONS.has(body.reason!)) {
    return Response.json({ error: "Invalid listen" }, { status: 400 });
  }
  await recordListen(user.id, {
    songId: body.songId,
    playedMs,
    positionMs,
    durationMs: int(body.durationMs, 6 * HOUR_MS) || undefined,
    heard: (int(body.heard, 2 ** 20 - 1) ?? 0) | 0,
    replays: int(body.replays, 100) ?? 0,
    reason: body.reason!,
    context: body.context === "autoplay" ? "autoplay" : undefined,
  });
  return new Response(null, { status: 204 });
});
