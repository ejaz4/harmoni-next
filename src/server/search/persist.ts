import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { mergeListening } from "../discovery/listens";
import { prepare, type TrackInfo } from "../matching/matcher";
import { displayTitle, normalizeText, parseTitle, splitArtistNames } from "../matching/normalize";
import type { ProviderRef, SongCandidate } from "../providers/types";
import { parseSource, type SourceRef } from "../sources";
import { persistQueue, type Lane } from "./persist-queue";

// A provider's search result, with what matching needs precomputed.
export interface Hit {
  candidate: SongCandidate;
  ref: SourceRef;
  rank: number;
  prepared: ReturnType<typeof prepare>;
}

export interface Member {
  hit: Hit;
  confidence: number;
  matchedBy: "origin" | "isrc" | "fuzzy";
}

export function toHit(candidate: SongCandidate, rank: number): Hit {
  const track: TrackInfo = {
    title: candidate.title,
    artists: candidate.artists.map((a) => a.name),
    durationMs: candidate.durationMs,
    isrc: candidate.isrc,
  };
  return { candidate, ref: parseSource(candidate.source), rank, prepared: prepare(track) };
}

// The credits a candidate implies: its listed artists, then featured artists
// pulled from its title.
export function songCredits(candidate: SongCandidate): { ref: ProviderRef; role: string }[] {
  const credits: { ref: ProviderRef; role: string }[] = [];
  for (const artist of candidate.artists) {
    const names = splitArtistNames([artist.name]);
    // "A & B" in a single provider credit can't be tied to one provider ID.
    if (names.length === 1) credits.push({ ref: artist, role: "primary" });
    else names.forEach((name) => credits.push({ ref: { name }, role: "primary" }));
  }
  for (const name of parseTitle(candidate.title).featured) {
    if (!credits.some((c) => normalizeText(c.ref.name) === normalizeText(name))) {
      credits.push({ ref: { name }, role: "featured" });
    }
  }
  return credits;
}

export interface PersistJob {
  songId: string;
  canonical?: Hit; // sets the metadata if the song doesn't exist yet
  members: Member[]; // sources to link
}

export function enqueuePersist(job: PersistJob, lane: Lane = "now") {
  persistQueue.enqueue(job.songId, () => persistGroup(job), lane);
}

// Creates the song if needed and links the members as sources.
export async function persistGroup(job: PersistJob): Promise<string> {
  return db.$transaction(async (tx) => {
    let songId = persistQueue.resolve(job.songId);
    const exists = await tx.song.findUnique({ where: { id: songId }, select: { id: true } });
    if (!exists) {
      // Another search may have saved one of these sources since we looked.
      const taken = await tx.songSource.findFirst({
        where: { OR: job.members.map((m) => ({ provider: m.hit.ref.provider, externalId: m.hit.ref.externalId })) },
        select: { songId: true },
      });
      if (taken) {
        persistQueue.alias(songId, taken.songId);
        songId = taken.songId;
      } else {
        if (!job.canonical) throw new Error(`song ${songId} missing and no canonical hit to create it`);
        await createSong(tx, songId, job.canonical);
      }
    }

    const isrc = job.members.find((m) => m.hit.prepared.isrc)?.hit.prepared.isrc;
    if (isrc) await tx.song.updateMany({ where: { id: songId, isrc: null }, data: { isrc } });
    // Some providers (TIDAL, MusicBrainz) carry no artwork; borrow it from any copy that does.
    const artworkUrl = job.members.find((m) => m.hit.candidate.artworkUrl)?.hit.candidate.artworkUrl;
    if (artworkUrl) await tx.song.updateMany({ where: { id: songId, artworkUrl: null }, data: { artworkUrl } });

    await tx.songSource.createMany({
      data: job.members.map(({ hit, confidence, matchedBy }) => ({
        songId,
        provider: hit.ref.provider,
        externalId: hit.ref.externalId,
        confidence,
        matchedBy,
        rawTitle: hit.candidate.title,
        rawArtists: hit.candidate.artists.map((a) => a.name),
        rawAlbum: hit.candidate.album?.name,
        durationMs: hit.candidate.durationMs,
        isrc: hit.prepared.isrc,
      })),
      skipDuplicates: true,
    });

    await linkProviderRefs(tx, songId, job.members.map((m) => m.hit));
    return songId;
  });
}

// Folds one song into another when they turn out to be the same recording
// (e.g. saved apart before the matcher could tell). The dropped id keeps
// working through the queue's alias.
export async function mergeSongs(keepId: string, dropId: string) {
  keepId = persistQueue.resolve(keepId);
  dropId = persistQueue.resolve(dropId);
  if (keepId === dropId) return;
  await db.$transaction(async (tx) => {
    const [keep, drop] = await Promise.all(
      [keepId, dropId].map((id) =>
        tx.song.findUnique({ where: { id }, include: { artists: { include: { artist: true } } } }),
      ),
    );
    if (!keep || !drop) return;

    await tx.songSource.updateMany({ where: { songId: dropId }, data: { songId: keepId } });
    // Move people's library data across before the dropped song (and its cascades) goes.
    await tx.playlistItem.updateMany({ where: { songId: dropId }, data: { songId: keepId } });
    await tx.play.updateMany({ where: { songId: dropId }, data: { songId: keepId } });
    await mergeListening(tx, keepId, dropId);
    const likes = await tx.like.findMany({ where: { songId: dropId } });
    if (likes.length) {
      await tx.like.createMany({
        data: likes.map((l) => ({ userId: l.userId, songId: keepId, createdAt: l.createdAt })),
        skipDuplicates: true, // already liked both copies
      });
    }
    const seeds = await tx.spiceSeed.findMany({ where: { songId: dropId } });
    if (seeds.length) {
      await tx.spiceSeed.createMany({ data: seeds.map((s) => ({ spiceId: s.spiceId, songId: keepId, addedAt: s.addedAt })), skipDuplicates: true });
    }
    const credited = new Set(keep.artists.map((a) => a.artistId));
    let position = keep.artists.length;
    for (const a of drop.artists) {
      if (credited.has(a.artistId)) continue;
      await tx.songArtist.create({ data: { songId: keepId, artistId: a.artistId, position: position++, role: "featured" } });
    }
    await tx.song.update({
      where: { id: keepId },
      data: {
        isrc: keep.isrc ?? drop.isrc,
        durationMs: keep.durationMs ?? drop.durationMs,
        artworkUrl: keep.artworkUrl ?? drop.artworkUrl,
        albumId: keep.albumId ?? drop.albumId,
      },
    });
    await tx.song.delete({ where: { id: dropId } });
  });
  persistQueue.alias(dropId, keepId);
  console.info(`persist: merged song ${dropId} into ${keepId}`);
}

async function createSong(tx: Prisma.TransactionClient, id: string, hit: Hit) {
  const { candidate, ref } = hit;
  const songArtists: { artistId: string; role: string }[] = [];
  for (const credit of songCredits(candidate)) {
    const artistId = await resolveArtist(tx, credit.ref);
    if (!songArtists.some((a) => a.artistId === artistId)) {
      songArtists.push({ artistId, role: credit.role });
    }
  }
  const albumId = candidate.album
    ? await resolveAlbum(tx, candidate.album, songArtists[0]?.artistId, candidate.artworkUrl)
    : undefined;

  const song = await tx.song.create({
    data: {
      id,
      title: displayTitle(candidate.title),
      titleKey: parseTitle(candidate.title).core,
      durationMs: candidate.durationMs,
      isrc: hit.prepared.isrc,
      explicit: candidate.explicit ?? false,
      artworkUrl: candidate.artworkUrl,
      albumId,
      artists: {
        create: songArtists.map((a, position) => ({ ...a, position })),
      },
    },
  });
  console.info(`persist: new song ${song.id} "${song.title}" from ${ref.provider}`);
}

// Artists are matched by provider ID first, then by name. Same-name artists
// will collide until artist matching gets smarter.
async function resolveArtist(tx: Prisma.TransactionClient, ref: ProviderRef): Promise<string> {
  const source = ref.source ? parseSource(ref.source) : undefined;
  if (source) {
    const existing = await tx.artistSource.findUnique({
      where: { provider_externalId: source },
      select: { artistId: true },
    });
    if (existing) return existing.artistId;
  }
  const nameKey = normalizeText(ref.name);
  const artist =
    (await tx.artist.findFirst({ where: { nameKey }, select: { id: true } })) ??
    (await tx.artist.create({ data: { name: ref.name, nameKey }, select: { id: true } }));
  if (source) {
    await tx.artistSource.createMany({
      data: [{ artistId: artist.id, ...source, rawName: ref.name }],
      skipDuplicates: true,
    });
  }
  return artist.id;
}

async function resolveAlbum(
  tx: Prisma.TransactionClient,
  ref: ProviderRef,
  primaryArtistId: string | undefined,
  artworkUrl: string | undefined,
): Promise<string> {
  const source = ref.source ? parseSource(ref.source) : undefined;
  if (source) {
    const existing = await tx.albumSource.findUnique({
      where: { provider_externalId: source },
      select: { albumId: true },
    });
    if (existing) return existing.albumId;
  }
  const titleKey = normalizeText(displayTitle(ref.name));
  const album =
    (await tx.album.findFirst({
      where: { titleKey, ...(primaryArtistId && { artists: { some: { id: primaryArtistId } } }) },
      select: { id: true },
    })) ??
    (await tx.album.create({
      data: {
        title: ref.name,
        titleKey,
        artworkUrl,
        ...(primaryArtistId && { artists: { connect: { id: primaryArtistId } } }),
      },
      select: { id: true },
    }));
  if (source) {
    await tx.albumSource.createMany({
      data: [{ albumId: album.id, ...source, rawTitle: ref.name }],
      skipDuplicates: true,
    });
  }
  return album.id;
}

// When a provider's copy joins a song, record its artist and album IDs too,
// tied to the song's existing artists/album by name. Credits the song is
// missing (Deezer often omits featured artists) are added as featured.
async function linkProviderRefs(tx: Prisma.TransactionClient, songId: string, hits: Hit[]) {
  const song = await tx.song.findUniqueOrThrow({
    where: { id: songId },
    include: { artists: { include: { artist: true } }, album: true },
  });
  const artistSources: Prisma.ArtistSourceCreateManyInput[] = [];
  const albumSources: Prisma.AlbumSourceCreateManyInput[] = [];
  const credited = new Set(song.artists.map((a) => a.artist.nameKey));
  let position = song.artists.length;
  for (const { candidate } of hits) {
    for (const ref of candidate.artists) {
      if (!ref.source) continue;
      const match = song.artists.find((a) => a.artist.nameKey === normalizeText(ref.name));
      if (match) artistSources.push({ artistId: match.artistId, ...parseSource(ref.source), rawName: ref.name });
    }
    for (const { ref } of songCredits(candidate)) {
      if (credited.has(normalizeText(ref.name))) continue;
      credited.add(normalizeText(ref.name));
      const artistId = await resolveArtist(tx, ref);
      await tx.songArtist.createMany({
        data: [{ songId, artistId, position: position++, role: "featured" }],
        skipDuplicates: true,
      });
    }
    const album = candidate.album;
    if (album?.source && song.album && song.album.titleKey === normalizeText(displayTitle(album.name))) {
      albumSources.push({ albumId: song.album.id, ...parseSource(album.source), rawTitle: album.name });
    }
  }
  if (artistSources.length) await tx.artistSource.createMany({ data: artistSources, skipDuplicates: true });
  if (albumSources.length) await tx.albumSource.createMany({ data: albumSources, skipDuplicates: true });
}
