import type { Prisma } from "@/generated/prisma/client";
import { artUrl } from "../artwork";
import { db } from "../db";
import { getRegistry } from "../providers/registry";

// The song shape every API returns, from search results to playlists.

export interface SourceResult {
  uri: string;
  provider: string;
  playable: boolean;
  confidence: number;
  matchedBy: string;
  rawTitle: string;
}

// Search builds these in memory and saves in the background, so artist and
// album ids are missing until a new song has been written.
export interface SongResult {
  id: string;
  title: string;
  artists: { id?: string; name: string; role: string }[];
  album?: { id?: string; title: string };
  durationMs?: number;
  isrc?: string;
  explicit: boolean;
  artworkUrl?: string;
  sources: SourceResult[];
}

export const SONG_INCLUDE = {
  artists: { include: { artist: true }, orderBy: { position: "asc" } },
  album: true,
  sources: true,
} satisfies Prisma.SongInclude;

export type SongWithRelations = Prisma.SongGetPayload<{ include: typeof SONG_INCLUDE }>;

export function songView(song: SongWithRelations): SongResult {
  const registry = getRegistry();
  return {
    id: song.id,
    title: song.title,
    artists: song.artists.map((a) => ({ id: a.artist.id, name: a.artist.name, role: a.role })),
    album: song.album ? { id: song.album.id, title: song.album.title } : undefined,
    durationMs: song.durationMs ?? undefined,
    isrc: song.isrc ?? undefined,
    explicit: song.explicit,
    artworkUrl: artUrl(song.artworkUrl),
    sources: song.sources.map((s) => ({
      uri: `${s.provider}:${s.externalId}`,
      provider: s.provider,
      playable: registry.has(s.provider, "song"),
      confidence: s.confidence,
      matchedBy: s.matchedBy,
      rawTitle: s.rawTitle,
    })),
  };
}

// Loads songs by id and returns them in the order given (duplicates kept).
export async function songViews(ids: string[]): Promise<SongResult[]> {
  if (!ids.length) return [];
  const songs = await db.song.findMany({ where: { id: { in: [...new Set(ids)] } }, include: SONG_INCLUDE });
  const byId = new Map(songs.map((s) => [s.id, songView(s)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
