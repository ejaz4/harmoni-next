import { db } from "../db";
import { persistQueue } from "../search/persist-queue";
import { SONG_INCLUDE, songView, songViews, type SongResult } from "./song-view";

// Everything here takes the signed-in user's id from the route, never from
// the request body, so nobody can touch another person's library.

// Search hands out ids for songs still being saved; wait for them, follow merges.
const settle = (songId: string) => persistQueue.settled(songId);

export class NotFound extends Error {}
// Its message is shown to the person: say what to do differently.
export class BadRequest extends Error {}

// --- Likes ---

export async function likedSongs(userId: string, limit?: number): Promise<SongResult[]> {
  const likes = await db.like.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, select: { songId: true } });
  return songViews(likes.map((l) => l.songId));
}

export async function likedIds(userId: string): Promise<string[]> {
  return (await db.like.findMany({ where: { userId }, select: { songId: true } })).map((l) => l.songId);
}

export async function setLiked(userId: string, requestedId: string, liked: boolean): Promise<string> {
  const songId = await settle(requestedId);
  if (liked) {
    if (!(await db.song.findUnique({ where: { id: songId }, select: { id: true } }))) throw new NotFound();
    await db.like.upsert({ where: { userId_songId: { userId, songId } }, create: { userId, songId }, update: {} });
  } else {
    await db.like.deleteMany({ where: { userId, songId } });
  }
  return songId;
}

// --- History ---

export async function recordPlay(userId: string, requestedId: string): Promise<void> {
  const songId = await settle(requestedId);
  if (!(await db.song.findUnique({ where: { id: songId }, select: { id: true } }))) throw new NotFound();
  await db.play.create({ data: { userId, songId } });
}

// Most recent first, each song once.
export async function recentSongs(userId: string, limit = 50): Promise<SongResult[]> {
  const rows = await db.play.findMany({
    where: { userId },
    orderBy: { playedAt: "desc" },
    take: limit * 4,
    select: { songId: true },
  });
  return songViews([...new Set(rows.map((r) => r.songId))].slice(0, limit));
}

// --- Playlists ---

export interface PlaylistSummary {
  id: string;
  name: string;
  description?: string;
  count: number;
  artworks: string[]; // up to four, for a collage cover
  updatedAt: Date;
}

export async function listPlaylists(userId: string): Promise<PlaylistSummary[]> {
  const playlists = await db.playlist.findMany({
    where: { ownerId: userId },
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
    artworks: [...new Set(p.items.flatMap((i) => (i.song.artworkUrl ? [i.song.artworkUrl] : [])))].slice(0, 4),
    updatedAt: p.updatedAt,
  }));
}

async function ownPlaylist(userId: string, playlistId: string) {
  const playlist = await db.playlist.findFirst({ where: { id: playlistId, ownerId: userId } });
  if (!playlist) throw new NotFound();
  return playlist;
}

export async function createPlaylist(userId: string, name: string, description?: string) {
  return db.playlist.create({ data: { ownerId: userId, name, description } });
}

export async function updatePlaylist(userId: string, playlistId: string, data: { name?: string; description?: string | null }) {
  await ownPlaylist(userId, playlistId);
  return db.playlist.update({ where: { id: playlistId }, data });
}

export async function deletePlaylist(userId: string, playlistId: string) {
  await ownPlaylist(userId, playlistId);
  await db.playlist.delete({ where: { id: playlistId } });
}

export async function addToPlaylist(userId: string, playlistId: string, requestedId: string) {
  await ownPlaylist(userId, playlistId);
  const songId = await settle(requestedId);
  if (!(await db.song.findUnique({ where: { id: songId }, select: { id: true } }))) throw new NotFound();
  const last = await db.playlistItem.findFirst({ where: { playlistId }, orderBy: { position: "desc" }, select: { position: true } });
  const item = await db.playlistItem.create({ data: { playlistId, songId, position: (last?.position ?? -1) + 1 } });
  await db.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
  return item;
}

export async function removeFromPlaylist(userId: string, playlistId: string, itemId: string) {
  await ownPlaylist(userId, playlistId);
  await db.playlistItem.deleteMany({ where: { id: itemId, playlistId } });
  await db.playlist.update({ where: { id: playlistId }, data: { updatedAt: new Date() } });
}

// --- Catalogue pages ---

export async function getSong(requestedId: string): Promise<SongResult> {
  const songId = await settle(requestedId);
  const song = await db.song.findUnique({ where: { id: songId }, include: SONG_INCLUDE });
  if (!song) throw new NotFound();
  return songView(song);
}

// Home: what to put in front of someone when they open the app.
export async function home(userId: string) {
  const [recent, liked, playlists] = await Promise.all([recentSongs(userId, 12), likedSongs(userId, 12), listPlaylists(userId)]);
  return { recent, liked, playlists: playlists.slice(0, 8) };
}
