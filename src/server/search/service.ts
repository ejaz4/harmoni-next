import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { compare, prepare, type TrackInfo } from "../matching/matcher";
import { displayTitle, normalizeText, parseTitle, splitArtistNames } from "../matching/normalize";
import { ProviderError, withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { ProviderRef, SongCandidate } from "../providers/types";
import { parseSource, type SourceRef } from "../sources";

const PROVIDER_DEADLINE_MS = 5000;
const PER_PROVIDER_LIMIT = 10;

export interface ProviderStatus {
  prefix: string;
  name: string;
  ok: boolean;
  error?: string;
  count: number;
  ms: number;
}

export interface SourceResult {
  uri: string;
  provider: string;
  playable: boolean;
  confidence: number;
  matchedBy: string;
  rawTitle: string;
}

export interface SongResult {
  id: string;
  title: string;
  artists: { id: string; name: string; role: string }[];
  album?: { id: string; title: string };
  durationMs?: number;
  isrc?: string;
  explicit: boolean;
  artworkUrl?: string;
  sources: SourceResult[];
}

export interface SearchResponse {
  query: string;
  providers: ProviderStatus[];
  results: SongResult[];
  tookMs: number;
}

interface Hit {
  candidate: SongCandidate;
  ref: SourceRef;
  rank: number;
  prepared: ReturnType<typeof prepare>;
}

interface Member {
  hit: Hit;
  confidence: number;
  matchedBy: "origin" | "isrc" | "fuzzy";
  isNew: boolean;
}

// One canonical song in the making: an existing Song and/or this search's hits.
interface Group {
  songId?: string;
  reps: ReturnType<typeof prepare>[];
  members: Member[];
}

export async function searchSongs(query: string): Promise<SearchResponse> {
  const started = Date.now();
  const { statuses, hits } = await fanOut(query);
  const groups = await groupHits(hits);
  const visible = groups.filter((g) => g.members.length > 0);

  // Sequential so two songs by the same artist don't race to create that artist.
  for (const group of visible) {
    group.songId = await persistGroup(group);
  }

  const songs = await db.song.findMany({
    where: { id: { in: visible.map((g) => g.songId!) } },
    include: {
      artists: { include: { artist: true }, orderBy: { position: "asc" } },
      album: true,
      sources: true,
    },
  });
  const byId = new Map(songs.map((s) => [s.id, s]));
  const registry = getRegistry();

  const results = visible
    .map((g) => ({ g, score: groupScore(g) }))
    .sort((a, b) => b.score - a.score)
    .flatMap(({ g }) => {
      const song = byId.get(g.songId!);
      if (!song) return [];
      return [
        {
          id: song.id,
          title: song.title,
          artists: song.artists.map((a) => ({ id: a.artist.id, name: a.artist.name, role: a.role })),
          album: song.album ? { id: song.album.id, title: song.album.title } : undefined,
          durationMs: song.durationMs ?? undefined,
          isrc: song.isrc ?? undefined,
          explicit: song.explicit,
          artworkUrl: song.artworkUrl ?? undefined,
          sources: song.sources.map((s) => ({
            uri: `${s.provider}:${s.externalId}`,
            provider: s.provider,
            playable: registry.has(s.provider, "song"),
            confidence: s.confidence,
            matchedBy: s.matchedBy,
            rawTitle: s.rawTitle,
          })),
        } satisfies SongResult,
      ];
    });

  return { query, providers: statuses, results, tookMs: Date.now() - started };
}

async function fanOut(query: string) {
  const providers = getRegistry().withRole("search");
  const settled = await Promise.all(
    providers.map(async (p) => {
      const t0 = Date.now();
      try {
        const songs = await withDeadline(
          p.search!.searchSongs(query, PER_PROVIDER_LIMIT),
          PROVIDER_DEADLINE_MS,
          p.prefix,
        );
        return { p, songs, ms: Date.now() - t0 };
      } catch (err) {
        console.warn(`search: ${p.prefix} failed`, err);
        const error = err instanceof ProviderError ? err.message : String(err);
        return { p, songs: [] as SongCandidate[], error, ms: Date.now() - t0 };
      }
    }),
  );

  const statuses: ProviderStatus[] = settled.map(({ p, songs, error, ms }) => ({
    prefix: p.prefix,
    name: p.name,
    ok: !error,
    error,
    count: songs.length,
    ms,
  }));

  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const { songs } of settled) {
    songs.forEach((candidate, rank) => {
      if (seen.has(candidate.source)) return;
      seen.add(candidate.source);
      hits.push({ candidate, ref: parseSource(candidate.source), rank, prepared: prepare(toTrack(candidate)) });
    });
  }
  return { statuses, hits };
}

async function groupHits(hits: Hit[]): Promise<Group[]> {
  if (!hits.length) return [];
  const registry = getRegistry();

  // Sources we've seen before skip matching entirely.
  const byProvider = new Map<string, string[]>();
  for (const h of hits) {
    byProvider.set(h.ref.provider, [...(byProvider.get(h.ref.provider) ?? []), h.ref.externalId]);
  }
  const known = await db.songSource.findMany({
    where: {
      OR: [...byProvider].map(([provider, ids]) => ({ provider, externalId: { in: ids } })),
    },
    select: { provider: true, externalId: true, songId: true, confidence: true, matchedBy: true },
  });
  const knownByUri = new Map(known.map((k) => [`${k.provider}:${k.externalId}`, k]));

  // Existing songs that new hits might belong to, found by ISRC or core title.
  const unknown = hits.filter((h) => !knownByUri.has(h.candidate.source));
  const isrcs = unknown.flatMap((h) => (h.prepared.isrc ? [h.prepared.isrc] : []));
  const titleKeys = [...new Set(unknown.map((h) => h.prepared.core).filter(Boolean))];
  const existing = unknown.length
    ? await db.song.findMany({
        where: { OR: [{ isrc: { in: isrcs } }, { titleKey: { in: titleKeys } }] },
        include: { artists: { include: { artist: true }, orderBy: { position: "asc" } } },
      })
    : [];

  const groups = new Map<string, Group>();
  const songGroup = (songId: string) => {
    let g = groups.get(songId);
    if (!g) groups.set(songId, (g = { songId, reps: [], members: [] }));
    return g;
  };
  for (const song of existing) {
    songGroup(song.id).reps.push(
      prepare({
        title: song.title,
        artists: song.artists.map((a) => a.artist.name),
        durationMs: song.durationMs ?? undefined,
        isrc: song.isrc ?? undefined,
      }),
    );
  }
  for (const h of hits) {
    const k = knownByUri.get(h.candidate.source);
    if (!k) continue;
    const g = songGroup(k.songId);
    g.reps.push(h.prepared);
    g.members.push({
      hit: h,
      confidence: k.confidence,
      matchedBy: k.matchedBy as Member["matchedBy"],
      isNew: false,
    });
  }

  // Best-ranked, most trusted hits first, so they become the anchors others join.
  const priority = (h: Hit) => registry.get(h.ref.provider)?.metadataPriority ?? 100;
  unknown.sort((a, b) => a.rank - b.rank || priority(a) - priority(b));

  const fresh: Group[] = [];
  for (const h of unknown) {
    let best: { group: Group; score: number; reason: string } | undefined;
    for (const group of [...groups.values(), ...fresh]) {
      for (const rep of group.reps) {
        const r = compare(h.prepared, rep);
        if (r.decision === "match" && (!best || r.score > best.score)) {
          best = { group, score: r.score, reason: r.reason };
        }
      }
    }
    if (best) {
      best.group.reps.push(h.prepared);
      best.group.members.push({
        hit: h,
        confidence: best.score,
        matchedBy: best.reason === "isrc" ? "isrc" : "fuzzy",
        isNew: true,
      });
    } else {
      fresh.push({ reps: [h.prepared], members: [{ hit: h, confidence: 1, matchedBy: "origin", isNew: true }] });
    }
  }
  return [...groups.values(), ...fresh];
}

// Writes the song (if new) and any new sources. Returns the song id.
async function persistGroup(group: Group): Promise<string> {
  const registry = getRegistry();
  const newMembers = group.members.filter((m) => m.isNew);
  if (group.songId && !newMembers.length) return group.songId;

  return db.$transaction(async (tx) => {
    let songId = group.songId;
    if (!songId) {
      // The most trusted provider's copy sets the canonical metadata.
      const priority = (m: Member) => registry.get(m.hit.ref.provider)?.metadataPriority ?? 100;
      const canonical = [...group.members].sort((a, b) => priority(a) - priority(b))[0];
      songId = await createSong(tx, canonical.hit);
    }

    const isrc = group.members.find((m) => m.hit.prepared.isrc)?.hit.prepared.isrc;
    if (isrc) await tx.song.updateMany({ where: { id: songId, isrc: null }, data: { isrc } });

    await tx.songSource.createMany({
      data: newMembers.map(({ hit, confidence, matchedBy }) => ({
        songId: songId!,
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

    await linkProviderRefs(tx, songId, newMembers.map((m) => m.hit));
    return songId;
  });
}

async function createSong(tx: Prisma.TransactionClient, hit: Hit): Promise<string> {
  const { candidate, ref } = hit;
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

  const songArtists: { artistId: string; role: string }[] = [];
  for (const credit of credits) {
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
  console.info(`search: new song ${song.id} "${song.title}" from ${ref.provider}`);
  return song.id;
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
    const credits = [
      ...candidate.artists.filter((a) => splitArtistNames([a.name]).length === 1),
      ...parseTitle(candidate.title).featured.map((name) => ({ name })),
    ];
    for (const ref of credits) {
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

// Songs that several providers return, and rank highly, come first.
function groupScore(group: Group): number {
  return group.members.reduce((sum, m) => sum + 1 / (1 + m.hit.rank), 0);
}

function toTrack(c: SongCandidate): TrackInfo {
  return {
    title: c.title,
    artists: c.artists.map((a) => a.name),
    durationMs: c.durationMs,
    isrc: c.isrc,
  };
}
