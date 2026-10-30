import type { AdminUser } from "@/lib/admin";
import { db } from "@/server/db";
import { withAdmin } from "@/server/session";

// Everyone with an account here: admins first, then by when they joined.
export const GET = withAdmin(async () => {
  const [users, seen] = await Promise.all([
    db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        username: true,
        displayUsername: true,
        role: true,
        suspended: true,
        createdAt: true,
        inviteUsed: { select: { createdBy: { select: { name: true } } } },
        _count: { select: { plays: true, likes: true, playlists: true } },
      },
    }),
    db.session.groupBy({ by: ["userId"], _max: { updatedAt: true } }),
  ]);
  const lastSeen = new Map(seen.map((s) => [s.userId, s._max.updatedAt]));
  const list: AdminUser[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    username: u.displayUsername ?? u.username ?? u.name,
    role: u.role === "admin" ? "admin" : "user",
    suspended: u.suspended,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: lastSeen.get(u.id)?.toISOString() ?? null,
    plays: u._count.plays,
    likes: u._count.likes,
    playlists: u._count.playlists,
    invitedBy: u.inviteUsed?.createdBy.name ?? null,
  }));
  list.sort((a, b) => (a.role === b.role ? 0 : a.role === "admin" ? -1 : 1));
  return Response.json(list);
});
