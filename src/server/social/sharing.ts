import { randomBytes } from "node:crypto";
import { db } from "../db";
import { BadRequest, NotFound, type PlaylistSummary } from "../library/service";
import { SONG_INCLUDE, songView, type SongResult } from "../library/song-view";
import { userCards, type UserCard } from "./profile";

// Who can open a playlist besides its owner:
//   private  nobody
//   link     anyone signed in here who has the link (it carries shareKey)
//   users    the people it's shared with
//   public   everyone here; it's on the owner's profile too
// Only the owner can change it. Everyone else can open it and play it.

export const VISIBILITIES = ["private", "link", "users", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const isVisibility = (v: unknown): v is Visibility => VISIBILITIES.includes(v as Visibility);

export interface PlaylistView {
  id: string;
  name: string;
  description?: string;
  updatedAt: Date;
  items: { itemId: string; addedAt: Date; song: SongResult }[];
  owner: UserCard;
  owned: boolean;
  visibility: Visibility;
  shareUrl?: string; // owner only, while it's "link": the path to share
  sharedWith?: UserCard[]; // owner only
}

const newKey = () => randomBytes(9).toString("base64url");
const sharePath = (id: string, key: string) => `/playlist/${id}?key=${key}`;

async function canOpen(viewerId: string, p: { id: string; ownerId: string; visibility: string; shareKey: string | null }, key?: string | null): Promise<boolean> {
  if (p.ownerId === viewerId || p.visibility === "public") return true;
  if (p.visibility === "link") return !!key && key === p.shareKey;
  if (p.visibility === "users") return !!(await db.playlistShare.findUnique({ where: { playlistId_userId: { playlistId: p.id, userId: viewerId } } }));
  return false;
}

export async function viewPlaylist(viewerId: string, playlistId: string, key?: string | null): Promise<PlaylistView> {
  const p = await db.playlist.findUnique({ where: { id: playlistId } });
  // Someone else's playlist they can't open looks the same as no playlist.
  if (!p || !(await canOpen(viewerId, p, key))) throw new NotFound();
  const owned = p.ownerId === viewerId;
  const [items, [owner], shares] = await Promise.all([
    db.playlistItem.findMany({ where: { playlistId }, orderBy: { position: "asc" }, include: { song: { include: SONG_INCLUDE } } }),
    userCards([p.ownerId], viewerId),
    owned ? db.playlistShare.findMany({ where: { playlistId }, orderBy: { createdAt: "asc" }, select: { userId: true } }) : [],
  ]);
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? undefined,
    updatedAt: p.updatedAt,
    items: items.map((i) => ({ itemId: i.id, addedAt: i.addedAt, song: songView(i.song) })),
    owner,
    owned,
    visibility: isVisibility(p.visibility) ? p.visibility : "private",
    ...(owned && p.visibility === "link" && p.shareKey && { shareUrl: sharePath(p.id, p.shareKey) }),
    ...(owned && { sharedWith: await userCards(shares.map((s) => s.userId), viewerId) }),
  };
}

// Changing who can see it. Turning the link on makes one (kept if it's
// turned off and on again); `resetLink` makes a new one, so the old stops working.
export async function setVisibility(ownerId: string, playlistId: string, visibility: unknown, resetLink = false): Promise<{ visibility: Visibility; shareUrl?: string }> {
  if (visibility !== undefined && !isVisibility(visibility)) throw new BadRequest(`visibility must be one of ${VISIBILITIES.join(", ")}.`);
  const p = await db.playlist.findFirst({ where: { id: playlistId, ownerId } });
  if (!p) throw new NotFound();
  const next = (visibility as Visibility | undefined) ?? (isVisibility(p.visibility) ? p.visibility : "private");
  const shareKey = next === "link" && (!p.shareKey || resetLink) ? newKey() : resetLink ? null : p.shareKey;
  await db.playlist.update({ where: { id: playlistId }, data: { visibility: next, shareKey } });
  return { visibility: next, ...(next === "link" && shareKey && { shareUrl: sharePath(playlistId, shareKey) }) };
}

// The people it's shared with, as a whole list (by username). Unknown
// usernames, and the owner, are skipped.
export async function setShares(ownerId: string, playlistId: string, usernames: unknown): Promise<UserCard[]> {
  if (!Array.isArray(usernames) || usernames.length > 200 || !usernames.every((u) => typeof u === "string")) throw new BadRequest("usernames must be a list of usernames.");
  const p = await db.playlist.findFirst({ where: { id: playlistId, ownerId }, select: { id: true } });
  if (!p) throw new NotFound();
  const users = await db.user.findMany({
    where: { id: { not: ownerId }, suspended: false, OR: usernames.map((u) => ({ username: { equals: u, mode: "insensitive" as const } })) },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.$transaction([
    db.playlistShare.deleteMany({ where: { playlistId, userId: { notIn: ids } } }),
    db.playlistShare.createMany({ data: ids.map((userId) => ({ playlistId, userId })), skipDuplicates: true }),
  ]);
  return userCards(ids, ownerId);
}

export type SharedPlaylist = PlaylistSummary & { owner: UserCard };

// Playlists other people have shared with them (and still do), newest change first.
export async function sharedWithMe(userId: string): Promise<SharedPlaylist[]> {
  const playlists = await db.playlist.findMany({
    where: { visibility: "users", shares: { some: { userId } }, owner: { suspended: false } },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { items: true } },
      items: { orderBy: { position: "asc" }, take: 12, include: { song: { select: { artworkUrl: true } } } },
    },
  });
  const owners = new Map((await userCards([...new Set(playlists.map((p) => p.ownerId))], userId)).map((u) => [u.id, u]));
  return playlists.flatMap((p) => {
    const owner = owners.get(p.ownerId);
    if (!owner) return [];
    return [
      {
        id: p.id,
        name: p.name,
        description: p.description ?? undefined,
        count: p._count.items,
        artworks: [...new Set(p.items.flatMap((i) => (i.song.artworkUrl ? [i.song.artworkUrl] : [])))].slice(0, 4),
        updatedAt: p.updatedAt,
        owner,
      },
    ];
  });
}
