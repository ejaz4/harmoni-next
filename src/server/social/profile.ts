import type { Prisma } from "@/generated/prisma/client";
import { artUrl } from "../artwork";
import { artUrls } from "../artwork";
import { BIO_MAX, DEFAULT_ACCENT, isBanner, isFont, isHex, PINNED_MAX, type BannerKey, type FontKey } from "@/lib/profile-style";
import { db } from "../db";
import { loadTaste } from "../discovery/taste";
import { warmArtistProfile } from "../library/catalogue";
import { BadRequest, NotFound, type PlaylistSummary } from "../library/service";
import { songViews, type SongResult } from "../library/song-view";
import { persistQueue } from "../search/persist-queue";
import { deleteImage, mediaUrl, saveImage, type MediaKind } from "./media";

// Profiles and following. Everyone signed in to the server can see anyone's
// profile; what's on it is up to its owner.

export interface UserCard {
  id: string;
  username: string;
  name: string;
  avatarUrl?: string;
  accent: string;
  youFollow?: boolean; // the person asking follows them
  followsYou?: boolean; // they follow the person asking
}

export interface ProfileView {
  user: UserCard;
  isMe: boolean;
  bio?: string;
  accent: string;
  font: FontKey;
  banner: BannerKey | "image";
  bannerUrl?: string;
  // For the "artists" banner (and always on your own, to preview it): favourites first.
  topArtists?: BannerArtist[];
  followers: number;
  following: number;
  pinned: SongResult[];
  // Missing when they've hidden them (always there for their own profile).
  likes?: { count: number; songs: SongResult[] };
  playlists?: PlaylistSummary[];
  showLikes: boolean;
  showPlaylists: boolean;
  joinedAt: string;
}

export interface BannerArtist {
  id: string;
  name: string;
  imageUrl: string;
}

const LIKES_SHOWN = 20;
const BANNER_ARTISTS = 12;

// The artists they love most that have a photo. Ones without get looked up
// in the background, a few at a time, for next time.
async function topArtists(userId: string): Promise<BannerArtist[]> {
  const taste = await loadTaste(userId);
  const ids = [...taste.artists]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, BANNER_ARTISTS * 2)
    .map(([id]) => id);
  const rows = await db.artist.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, imageUrl: true, profile: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.flatMap((id) => byId.get(id) ?? []);
  ordered
    .filter((a) => !a.imageUrl && !a.profile)
    .slice(0, 3)
    .forEach((a) => void warmArtistProfile(a.id).catch(() => {}));
  return ordered.flatMap((a) => (a.imageUrl ? [{ id: a.id, name: a.name, imageUrl: artUrl(a.imageUrl)! }] : [])).slice(0, BANNER_ARTISTS);
}

const CARD_SELECT = {
  id: true,
  username: true,
  name: true,
  profile: { select: { avatarImage: true, accent: true } },
} satisfies Prisma.UserSelect;

type CardRow = Prisma.UserGetPayload<{ select: typeof CARD_SELECT }>;

async function cards(rows: CardRow[], viewerId: string): Promise<UserCard[]> {
  const ids = rows.map((r) => r.id);
  const [out, in_] = await Promise.all([
    db.follow.findMany({ where: { followerId: viewerId, followeeId: { in: ids } }, select: { followeeId: true } }),
    db.follow.findMany({ where: { followeeId: viewerId, followerId: { in: ids } }, select: { followerId: true } }),
  ]);
  const youFollow = new Set(out.map((f) => f.followeeId));
  const followsYou = new Set(in_.map((f) => f.followerId));
  return rows.map((r) => ({
    id: r.id,
    username: r.username ?? r.name,
    name: r.name,
    avatarUrl: mediaUrl(r.profile?.avatarImage),
    accent: r.profile?.accent ?? DEFAULT_ACCENT,
    ...(r.id !== viewerId && { youFollow: youFollow.has(r.id), followsYou: followsYou.has(r.id) }),
  }));
}

export async function userCards(userIds: string[], viewerId: string): Promise<UserCard[]> {
  const rows = await db.user.findMany({ where: { id: { in: userIds } }, select: CARD_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return cards(userIds.flatMap((id) => byId.get(id) ?? []), viewerId);
}

async function findUser(username: string) {
  const user = await db.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" }, suspended: false },
    include: { profile: true },
  });
  if (!user) throw new NotFound();
  return user;
}

// People by name or username: exact usernames first, then people they
// follow, then everyone else.
export async function searchUsers(query: string, viewerId: string, limit = 20): Promise<UserCard[]> {
  const q = query.trim().replace(/^@/, "");
  if (!q) return [];
  const rows = await db.user.findMany({
    where: { suspended: false, OR: [{ username: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
    select: CARD_SELECT,
    take: 60,
  });
  const found = await cards(rows, viewerId);
  const lower = q.toLowerCase();
  const rank = (u: UserCard) =>
    (u.username.toLowerCase() === lower ? 0 : 4) + (u.name.toLowerCase().startsWith(lower) || u.username.toLowerCase().startsWith(lower) ? 0 : 2) + (u.youFollow ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit);
}

export async function getProfile(username: string, viewerId: string): Promise<ProfileView> {
  const user = await findUser(username);
  const p = user.profile;
  const isMe = user.id === viewerId;
  const showLikes = p?.showLikes ?? true;
  const showPlaylists = p?.showPlaylists ?? true;
  const banner: ProfileView["banner"] = p?.banner === "image" && p.bannerImage ? "image" : isBanner(p?.banner) ? p.banner : "glow";
  const [[card], followers, following, pinned, likeCount, likeRows, playlists, artists] = await Promise.all([
    cards([{ id: user.id, username: user.username, name: user.name, profile: p && { avatarImage: p.avatarImage, accent: p.accent } }], viewerId),
    db.follow.count({ where: { followeeId: user.id } }),
    db.follow.count({ where: { followerId: user.id } }),
    songViews(p?.pinnedSongs ?? []),
    showLikes || isMe ? db.like.count({ where: { userId: user.id } }) : 0,
    showLikes || isMe ? db.like.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: LIKES_SHOWN, select: { songId: true } }) : [],
    showPlaylists || isMe ? publicPlaylists(user.id) : [],
    banner === "artists" || isMe ? topArtists(user.id) : undefined,
  ]);
  return {
    user: card,
    isMe,
    bio: p?.bio ?? undefined,
    accent: card.accent,
    font: isFont(p?.font) ? p.font : "default",
    banner,
    bannerUrl: p?.banner === "image" ? mediaUrl(p.bannerImage) : undefined,
    topArtists: artists,
    followers,
    following,
    pinned,
    ...((showLikes || isMe) && { likes: { count: likeCount, songs: await songViews(likeRows.map((l) => l.songId)) } }),
    ...((showPlaylists || isMe) && { playlists }),
    showLikes,
    showPlaylists,
    joinedAt: user.createdAt.toISOString(),
  };
}

// Their liked songs, newest first, if they show them.
export async function profileLikes(username: string, viewerId: string): Promise<SongResult[]> {
  const user = await findUser(username);
  if (user.id !== viewerId && !(user.profile?.showLikes ?? true)) throw new NotFound();
  const likes = await db.like.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { songId: true } });
  return songViews(likes.map((l) => l.songId));
}

async function publicPlaylists(userId: string): Promise<PlaylistSummary[]> {
  const playlists = await db.playlist.findMany({
    where: { ownerId: userId, visibility: "public" },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { items: true } },
      items: { orderBy: { position: "asc" }, take: 12, include: { song: { select: { artworkUrl: true } } } },
    },
  });
  return playlists.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? undefined,
    count: p._count.items,
    artworks: [...new Set(artUrls(p.items.map((i) => i.song.artworkUrl)))].slice(0, 4),
    updatedAt: p.updatedAt,
  }));
}

export interface ProfileChanges {
  name?: string;
  bio?: string | null;
  accent?: string | null;
  font?: string | null;
  banner?: string | null; // a preset; "image" only by uploading one
  pinnedSongs?: string[];
  showLikes?: boolean;
  showPlaylists?: boolean;
}

// Checks each field it's given and ignores the ones it isn't.
export async function updateProfile(userId: string, body: Partial<Record<keyof ProfileChanges, unknown>>): Promise<void> {
  const data: Prisma.ProfileUncheckedUpdateInput = {};
  if (body.bio !== undefined) {
    if (body.bio !== null && typeof body.bio !== "string") throw new BadRequest("bio must be a string or null.");
    data.bio = body.bio?.trim().slice(0, BIO_MAX) || null;
  }
  if (body.accent !== undefined) {
    if (body.accent !== null && !isHex(body.accent)) throw new BadRequest("accent must be a colour like #a59bff, or null.");
    data.accent = body.accent?.toLowerCase() ?? null;
  }
  if (body.font !== undefined) {
    if (body.font !== null && !isFont(body.font)) throw new BadRequest("That font isn't one of the choices.");
    data.font = body.font;
  }
  if (body.banner !== undefined) {
    if (body.banner !== null && !isBanner(body.banner)) throw new BadRequest("That banner isn't one of the choices.");
    data.banner = body.banner;
  }
  if (body.pinnedSongs !== undefined) {
    if (!Array.isArray(body.pinnedSongs) || !body.pinnedSongs.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)))
      throw new BadRequest("pinnedSongs must be a list of song ids.");
    data.pinnedSongs = await existing(body.pinnedSongs.slice(0, PINNED_MAX));
  }
  if (body.showLikes !== undefined) {
    if (typeof body.showLikes !== "boolean") throw new BadRequest("showLikes must be true or false.");
    data.showLikes = body.showLikes;
  }
  if (body.showPlaylists !== undefined) {
    if (typeof body.showPlaylists !== "boolean") throw new BadRequest("showPlaylists must be true or false.");
    data.showPlaylists = body.showPlaylists;
  }
  let name: string | undefined;
  if (body.name !== undefined) {
    name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) throw new BadRequest("Your name can't be empty.");
  }
  const old = data.banner !== undefined ? await db.profile.findUnique({ where: { userId }, select: { bannerImage: true } }) : null;
  await db.$transaction([
    ...(name ? [db.user.update({ where: { id: userId }, data: { name } })] : []),
    db.profile.upsert({
      where: { userId },
      create: { ...(data as Omit<Prisma.ProfileUncheckedCreateInput, "userId">), userId, ...(data.banner !== undefined && { bannerImage: null }) },
      update: { ...data, ...(data.banner !== undefined && { bannerImage: null }) },
    }),
  ]);
  // Picking a preset banner lets go of an uploaded one.
  if (data.banner !== undefined) await deleteImage(old?.bannerImage);
}

// Search results may still be saving: their ids once saved, that exist, in order, once each.
async function existing(ids: string[]): Promise<string[]> {
  const settled = [...new Set(await Promise.all(ids.map((id) => persistQueue.settled(id))))];
  const found = new Set((await db.song.findMany({ where: { id: { in: settled } }, select: { id: true } })).map((s) => s.id));
  return settled.filter((id) => found.has(id));
}

export async function setPinned(userId: string, songId: string, pinned: boolean): Promise<string[]> {
  const [id] = await existing([songId]);
  if (!id) throw new NotFound();
  const current = (await db.profile.findUnique({ where: { userId }, select: { pinnedSongs: true } }))?.pinnedSongs ?? [];
  if (pinned && !current.includes(id) && current.length >= PINNED_MAX) throw new BadRequest(`You can put ${PINNED_MAX} songs on display. Take one off first.`);
  const next = pinned ? [...current.filter((s) => s !== id), id] : current.filter((s) => s !== id);
  await db.profile.upsert({ where: { userId }, create: { userId, pinnedSongs: next }, update: { pinnedSongs: next } });
  return next;
}

// A new picture replaces the old one, which is deleted.
export async function setImage(userId: string, kind: MediaKind, bytes: Uint8Array | null): Promise<string | undefined> {
  const key = bytes ? await saveImage(kind, bytes) : null;
  const old = await db.profile.findUnique({ where: { userId }, select: { avatarImage: true, bannerImage: true, banner: true } });
  const data = kind === "avatar" ? { avatarImage: key } : { bannerImage: key, banner: key ? "image" : old?.banner === "image" ? null : old?.banner };
  await db.profile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await deleteImage(kind === "avatar" ? old?.avatarImage : old?.bannerImage);
  return mediaUrl(key);
}

// --- Following ---

export async function follow(viewerId: string, username: string, on: boolean): Promise<UserCard> {
  const user = await findUser(username);
  if (user.id === viewerId) throw new BadRequest("You can't follow yourself.");
  if (on) await db.follow.upsert({ where: { followerId_followeeId: { followerId: viewerId, followeeId: user.id } }, create: { followerId: viewerId, followeeId: user.id }, update: {} });
  else await db.follow.deleteMany({ where: { followerId: viewerId, followeeId: user.id } });
  return (await userCards([user.id], viewerId))[0];
}

// Newest first.
export async function followList(username: string, which: "followers" | "following", viewerId: string): Promise<UserCard[]> {
  const user = await findUser(username);
  const rows =
    which === "followers"
      ? (await db.follow.findMany({ where: { followeeId: user.id, follower: { suspended: false } }, orderBy: { createdAt: "desc" }, select: { followerId: true } })).map((f) => f.followerId)
      : (await db.follow.findMany({ where: { followerId: user.id, followee: { suspended: false } }, orderBy: { createdAt: "desc" }, select: { followeeId: true } })).map((f) => f.followeeId);
  return userCards(rows, viewerId);
}

// For the signed-in person's own account (GET /api/me).
export async function ownProfileBits(userId: string): Promise<{ avatarUrl?: string; accent: string; pinned: string[] }> {
  const p = await db.profile.findUnique({ where: { userId }, select: { avatarImage: true, accent: true, pinnedSongs: true } });
  return { avatarUrl: mediaUrl(p?.avatarImage), accent: p?.accent ?? DEFAULT_ACCENT, pinned: p?.pinnedSongs ?? [] };
}
