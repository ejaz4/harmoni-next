import type { AdminStats } from "@/lib/admin";
import { db } from "@/server/db";
import { onlineDevices } from "@/server/link/hub";
import { cacheUsage } from "@/server/playback/cache";
import { withAdmin } from "@/server/session";
import packageJson from "../../../../../package.json";

const WEEK_MS = 7 * 24 * 60 * 60_000;

// How this Harmoni is doing, for the top of Settings → Server.
export const GET = withAdmin(async () => {
  const weekAgo = new Date(Date.now() - WEEK_MS);
  const [people, admins, songs, artists, albums, playlists, spices, plays, playsThisWeek, listened, cache, online] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: "admin" } }),
    db.song.count(),
    db.artist.count(),
    db.album.count(),
    db.playlist.count(),
    db.spice.count(),
    db.play.count(),
    db.play.count({ where: { playedAt: { gt: weekAgo } } }),
    db.$queryRaw<{ ms: bigint | null }[]>`SELECT SUM(s."durationMs")::bigint AS ms FROM "Play" p JOIN "Song" s ON s.id = p."songId" WHERE p."playedAt" > ${weekAgo}`,
    cacheUsage(),
    onlineDevices().catch(() => null), // Valkey down: say nothing rather than fail
  ]);
  const stats: AdminStats = {
    people,
    admins,
    songs,
    artists,
    albums,
    playlists,
    spices,
    plays,
    playsThisWeek,
    listeningThisWeekMs: Number(listened[0]?.ms ?? 0),
    cache,
    online,
    uptimeS: Math.round(process.uptime()),
    version: packageJson.version,
    node: process.version,
  };
  return Response.json(stats);
});
