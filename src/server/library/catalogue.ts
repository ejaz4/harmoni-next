import type { Album, Artist, ArtistSource, Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { displayTitle, normalizeText } from "../matching/normalize";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { ArtistProfile, ProviderPlugin, ProviderRef, ReleaseCandidate, SongCandidate } from "../providers/types";
import { persistQueue } from "../search/persist-queue";
import { resolveCandidates } from "../search/service";
import { parseSource } from "../sources";
import { NotFound } from "./service";
import { songView, songViews, SONG_INCLUDE, type SongResult } from "./song-view";

// Artist and album pages built from ArtistProviders (Deezer for the
// discography, YouTube Music for bio, banner and playable top songs), turned
// into canonical songs, albums and artists, and cached. Like lyrics, a cached
// page is served straight away and rebuilt in the background when due.

const DAY = 24 * 60 * 60_000;
const PROFILE_REFRESH_MS = 7 * DAY;
const TRACKLIST_REFRESH_MS = 30 * DAY;
const PROVIDER_DEADLINE_MS = 12_000;
const POPULAR_COUNT = 10;

export interface AlbumCard {
  id: string;
  title: string;
  artworkUrl?: string;
  releaseDate?: string;
  kind?: string;
  trackCount?: number;
}

export interface ArtistCard {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface ArtistPage extends ArtistCard {
  bannerUrl?: string;
  bio?: string;
  fans?: number;
  popular: SongResult[];
  latest?: AlbumCard;
  albums: AlbumCard[];
  singles: AlbumCard[]; // singles and EPs
  compilations: AlbumCard[];
  related: ArtistCard[];
  yours: SongResult[]; // what this listener plays most by them
}

export interface AlbumPage extends AlbumCard {
  artists: ArtistCard[];
  label?: string;
  genres: string[];
  songs: SongResult[];
}

interface StoredProfile {
  popular: string[];
  releases: string[];
  related: string[];
}

// In-flight builds, so concurrent visitors share one.
const building = new Map<string, Promise<SongResult[]>>();

export async function getArtistPage(artistId: string, userId: string): Promise<ArtistPage> {
  const artist = await db.artist.findUnique({ where: { id: artistId }, include: { sources: true } });
  if (!artist) throw new NotFound();

  let freshPopular: SongResult[] | undefined;
  if (!artist.profile) {
    // First visit: build it now. The popular songs come back straight from
    // matching, before they've finished saving.
    freshPopular = await build(artist);
  } else if (!artist.profileRefreshAfter || artist.profileRefreshAfter <= new Date()) {
    void build(artist).catch((err) => console.warn(`catalogue: refreshing artist ${artistId} failed`, err));
  }

  const fresh = await db.artist.findUniqueOrThrow({ where: { id: artistId } });
  const profile = (fresh.profile as unknown as StoredProfile | null) ?? { popular: [], releases: [], related: [] };
  const [popular, releases, related, yours] = await Promise.all([
    // Waits for any still being saved (and follows merges) so none go missing.
    freshPopular ?? settleIds(profile.popular).then(songViews),
    db.album.findMany({ where: { id: { in: profile.releases } } }),
    db.artist.findMany({ where: { id: { in: profile.related } } }),
    yourTopSongs(artistId, userId),
  ]);

  // Nothing from providers (offline, or unknown to them): show what we have locally.
  const localPopular = popular.length ? popular : await localSongs(artistId, userId);
  const cards = releases.map(albumCard).sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
  const relatedById = new Map(related.map((a) => [a.id, a]));

  return {
    id: fresh.id,
    name: fresh.name,
    imageUrl: fresh.imageUrl ?? undefined,
    bannerUrl: fresh.bannerUrl ?? undefined,
    bio: fresh.bio ?? undefined,
    fans: fresh.fans ?? undefined,
    popular: localPopular.slice(0, POPULAR_COUNT),
    latest: cards[0],
    albums: cards.filter((c) => c.kind === "album" || !c.kind),
    singles: cards.filter((c) => c.kind === "single" || c.kind === "ep"),
    compilations: cards.filter((c) => c.kind === "compilation"),
    related: profile.related.flatMap((id) => {
      const a = relatedById.get(id);
      return a ? [{ id: a.id, name: a.name, imageUrl: a.imageUrl ?? undefined }] : [];
    }),
    yours,
  };
}

function build(artist: Artist & { sources: ArtistSource[] }): Promise<SongResult[]> {
  let pending = building.get(artist.id);
  if (!pending) {
    pending = buildProfile(artist).finally(() => building.delete(artist.id));
    building.set(artist.id, pending);
  }
  return pending;
}

// Deezer's ranking of popular tracks leads; YouTube Music adds bio and banner.
const ARTIST_ORDER = ["deezer", "ytm"];

async function buildProfile(artist: Artist & { sources: ArtistSource[] }): Promise<SongResult[]> {
  const rank = (p: ProviderPlugin) => (ARTIST_ORDER.includes(p.prefix) ? ARTIST_ORDER.indexOf(p.prefix) : ARTIST_ORDER.length);
  const providers = getRegistry().withRole("artist").sort((a, b) => rank(a) - rank(b));
  const started = Date.now();
  const lap = (() => {
    let last = started;
    return () => {
      const now = Date.now();
      const ms = now - last;
      last = now;
      return ms;
    };
  })();
  const profiles = (
    await Promise.all(
      providers.map(async (p) => {
        try {
          const externalId = await providerArtistId(p, artist);
          if (!externalId) return undefined;
          return await withDeadline(p.artist!.getArtist(externalId), PROVIDER_DEADLINE_MS, p.prefix);
        } catch (err) {
          console.warn(`catalogue: ${p.prefix} artist lookup failed for "${artist.name}"`, err);
          return undefined;
        }
      }),
    )
  ).filter((p): p is ArtistProfile => !!p);

  const tProviders = lap();
  const first = <T>(pick: (p: ArtistProfile) => T | undefined) => profiles.map(pick).find((v) => v !== undefined && v !== "");

  // Popular songs: providers' top tracks matched into canonical songs, in
  // the first provider's order, then anything only the others had.
  const tops = profiles.map((p) => p.topTracks.slice(0, POPULAR_COUNT));
  const resolved = await resolveCandidates(tops);
  const popular = dedupe(tops.flat().flatMap((c) => resolved.get(c.source) ?? [])).slice(0, POPULAR_COUNT);

  const tSongs = lap();
  const releaseIds = await upsertReleases(artist.id, profiles.flatMap((p) => p.releases));
  const tReleases = lap();
  const relatedIds = await upsertRelated(artist.id, profiles.find((p) => p.related.length)?.related ?? []);
  const tRelated = lap();

  const profile: StoredProfile = { popular: popular.map((s) => s.id), releases: releaseIds, related: relatedIds };
  await db.artist.update({
    where: { id: artist.id },
    data: {
      imageUrl: first((p) => p.imageUrl) ?? artist.imageUrl,
      bannerUrl: first((p) => p.bannerUrl) ?? artist.bannerUrl,
      bio: first((p) => p.bio) ?? artist.bio,
      fans: first((p) => p.fans) ?? artist.fans,
      profile: profile as unknown as Prisma.InputJsonValue,
      profileRefreshAfter: new Date(Date.now() + PROFILE_REFRESH_MS),
    },
  });

  console.info(
    `catalogue: built "${artist.name}" in ${Date.now() - started}ms (providers ${tProviders}, songs ${tSongs}, releases ${tReleases}, related ${tRelated})`,
  );

  // Matched songs may still be saving (or turn out to be merges); store
  // their final ids once they've landed.
  void settleIds(profile.popular).then((ids) =>
    db.artist.update({ where: { id: artist.id }, data: { profile: { ...profile, popular: ids } as unknown as Prisma.InputJsonValue } }),
  );
  return popular;
}

// The provider's id for this artist: a source we already know, else a
// lookup by name (remembered for next time unless another artist owns it).
async function providerArtistId(p: ProviderPlugin, artist: Artist & { sources: ArtistSource[] }): Promise<string | undefined> {
  const known = artist.sources.find((s) => s.provider === p.prefix);
  if (known) return known.externalId;
  const found = await withDeadline(p.artist!.findArtist(artist.name), PROVIDER_DEADLINE_MS, p.prefix);
  if (!found?.source) return undefined;
  const ref = parseSource(found.source);
  await db.artistSource.createMany({ data: [{ artistId: artist.id, ...ref, rawName: found.name }], skipDuplicates: true });
  return ref.externalId;
}

// Releases become canonical albums (matched to existing ones by provider id,
// then by title for this artist). Batched: a long discography would
// otherwise cost several round trips per release. Returns their ids.
async function upsertReleases(artistId: string, releases: ReleaseCandidate[]): Promise<string[]> {
  if (!releases.length) return [];
  const known = await db.albumSource.findMany({
    where: { OR: releases.map((r) => parseSource(r.source)) },
    select: { provider: true, externalId: true, albumId: true },
  });
  const knownBySource = new Map(known.map((k) => [`${k.provider}:${k.externalId}`, k.albumId]));
  const existing = await db.album.findMany({
    where: { OR: [{ id: { in: known.map((k) => k.albumId) } }, { artists: { some: { id: artistId } } }] },
  });
  const byId = new Map(existing.map((a) => [a.id, a]));
  const byTitle = new Map(existing.filter((a) => a.titleKey).map((a) => [a.titleKey, a.id]));

  // Match each release to an album id, or mark it to be created.
  const matched = releases.map((r) => {
    const titleKey = normalizeText(displayTitle(r.title));
    return { r, titleKey, id: knownBySource.get(r.source) ?? byTitle.get(titleKey) };
  });
  const toCreate = new Map<string, (typeof matched)[number]>();
  for (const m of matched) if (!m.id && !toCreate.has(m.titleKey)) toCreate.set(m.titleKey, m);

  if (toCreate.size) {
    const created = await db.album.createManyAndReturn({
      data: [...toCreate.values()].map(({ r, titleKey }) => ({
        title: r.title,
        titleKey,
        artworkUrl: r.artworkUrl,
        releaseDate: r.releaseDate ? new Date(r.releaseDate) : undefined,
        kind: r.kind,
        trackCount: r.trackCount,
      })),
      select: { id: true, titleKey: true },
    });
    created.forEach((c) => byTitle.set(c.titleKey, c.id));
    await db.artist.update({ where: { id: artistId }, data: { albums: { connect: created.map((c) => ({ id: c.id })) } } });
  }

  // Refresh metadata only where it changed (a weekly rebuild usually changes nothing).
  for (const { r, id } of matched) {
    const album = id ? byId.get(id) : undefined;
    if (!album) continue;
    const releaseDate = r.releaseDate ? new Date(r.releaseDate) : undefined;
    const data = {
      ...(releaseDate && album.releaseDate?.getTime() !== releaseDate.getTime() && { releaseDate }),
      ...(r.kind && album.kind !== r.kind && { kind: r.kind }),
      ...(r.trackCount && album.trackCount !== r.trackCount && { trackCount: r.trackCount }),
      ...(r.artworkUrl && !album.artworkUrl && { artworkUrl: r.artworkUrl }),
    };
    if (Object.keys(data).length) await db.album.update({ where: { id: album.id }, data });
  }

  const ids = matched.map((m) => m.id ?? byTitle.get(m.titleKey)!);
  await db.albumSource.createMany({
    data: matched.map((m, i) => ({ albumId: ids[i], ...parseSource(m.r.source), rawTitle: m.r.title })),
    skipDuplicates: true,
  });
  return [...new Set(ids)];
}

// Similar artists become canonical artists so their pages work. Batched
// like releases. Returns ids.
async function upsertRelated(artistId: string, related: (ProviderRef & { imageUrl?: string })[]): Promise<string[]> {
  const items = related.filter((r) => r.source).map((r) => ({ r, ref: parseSource(r.source!), nameKey: normalizeText(r.name) }));
  if (!items.length) return [];
  const bySource = new Map(
    (await db.artistSource.findMany({ where: { OR: items.map((i) => i.ref) }, select: { provider: true, externalId: true, artistId: true } })).map(
      (s) => [`${s.provider}:${s.externalId}`, s.artistId],
    ),
  );
  const byName = new Map(
    (await db.artist.findMany({ where: { nameKey: { in: items.map((i) => i.nameKey) } }, select: { id: true, nameKey: true } })).map((a) => [
      a.nameKey,
      a.id,
    ]),
  );
  const missing = items.filter((i) => !bySource.has(i.r.source!) && !byName.has(i.nameKey));
  if (missing.length) {
    const created = await db.artist.createManyAndReturn({
      data: missing.map((i) => ({ name: i.r.name, nameKey: i.nameKey, imageUrl: i.r.imageUrl })),
      select: { id: true, nameKey: true },
    });
    created.forEach((a) => byName.set(a.nameKey, a.id));
  }
  const ids = items.map((i) => bySource.get(i.r.source!) ?? byName.get(i.nameKey)!);
  await db.artistSource.createMany({
    data: items.map((i, n) => ({ artistId: ids[n], ...i.ref, rawName: i.r.name })),
    skipDuplicates: true,
  });
  // Give existing artists a photo if they had none.
  for (const [n, i] of items.entries()) {
    if (i.r.imageUrl) await db.artist.updateMany({ where: { id: ids[n], imageUrl: null }, data: { imageUrl: i.r.imageUrl } });
  }
  return [...new Set(ids)].filter((id) => id !== artistId);
}

// --- Albums ---

const fetchingTracks = new Map<string, Promise<SongResult[] | undefined>>();

export async function getAlbumPage(albumId: string): Promise<AlbumPage> {
  const album = await db.album.findUnique({ where: { id: albumId }, include: { artists: true, sources: true } });
  if (!album) throw new NotFound();

  let fresh: SongResult[] | undefined;
  if (!album.trackIds) fresh = await fetchTracklist(album);
  else if (!album.tracksRefreshAfter || album.tracksRefreshAfter <= new Date()) {
    void fetchTracklist(album).catch((err) => console.warn(`catalogue: refreshing album ${albumId} failed`, err));
  }

  const now = await db.album.findUniqueOrThrow({ where: { id: albumId }, include: { artists: true } });
  let songs = fresh ?? (Array.isArray(now.trackIds) ? await songViews(await settleIds(now.trackIds as string[])) : []);
  if (!songs.length) {
    // No provider tracklist: the songs we know are on it.
    songs = (await db.song.findMany({ where: { albumId }, include: SONG_INCLUDE, orderBy: { createdAt: "asc" } })).map(songView);
  }
  return {
    ...albumCard(now),
    artworkUrl: now.artworkUrl ?? songs.find((s) => s.artworkUrl)?.artworkUrl,
    artists: now.artists.map((a) => ({ id: a.id, name: a.name, imageUrl: a.imageUrl ?? undefined })),
    label: now.label ?? undefined,
    genres: now.genres,
    songs,
  };
}

function fetchTracklist(album: Album & { sources: { provider: string; externalId: string }[] }): Promise<SongResult[] | undefined> {
  let pending = fetchingTracks.get(album.id);
  if (!pending) {
    pending = loadTracklist(album).finally(() => fetchingTracks.delete(album.id));
    fetchingTracks.set(album.id, pending);
  }
  return pending;
}

async function loadTracklist(album: Album & { sources: { provider: string; externalId: string }[] }): Promise<SongResult[] | undefined> {
  const registry = getRegistry();
  for (const source of album.sources) {
    const provider = registry.get(source.provider)?.artist;
    if (!provider?.getRelease) continue;
    try {
      const release = await withDeadline(provider.getRelease(source.externalId), PROVIDER_DEADLINE_MS, source.provider);
      const resolved = await resolveCandidates([release.tracks]);
      const songs = dedupe(release.tracks.flatMap((t: SongCandidate) => resolved.get(t.source) ?? []));
      await db.album.update({
        where: { id: album.id },
        data: {
          label: release.label ?? album.label,
          genres: release.genres ?? album.genres,
          releaseDate: release.releaseDate ? new Date(release.releaseDate) : album.releaseDate,
          kind: release.kind ?? album.kind,
          trackCount: release.tracks.length || album.trackCount,
          artworkUrl: album.artworkUrl ?? release.artworkUrl,
          trackIds: songs.map((s) => s.id),
          tracksRefreshAfter: new Date(Date.now() + TRACKLIST_REFRESH_MS),
        },
      });
      void settleIds(songs.map((s) => s.id)).then((ids) => db.album.update({ where: { id: album.id }, data: { trackIds: ids } }));
      return songs;
    } catch (err) {
      console.warn(`catalogue: ${source.provider} tracklist failed for album ${album.id}`, err);
    }
  }
  // Nothing could provide it; don't ask again for a day.
  await db.album.update({ where: { id: album.id }, data: { tracksRefreshAfter: new Date(Date.now() + DAY), trackIds: album.trackIds ?? [] } });
  return undefined;
}

// --- Helpers ---

function albumCard(a: Album): AlbumCard {
  return {
    id: a.id,
    title: a.title,
    artworkUrl: a.artworkUrl ?? undefined,
    releaseDate: a.releaseDate?.toISOString().slice(0, 10),
    kind: a.kind ?? undefined,
    trackCount: a.trackCount ?? undefined,
  };
}

async function yourTopSongs(artistId: string, userId: string): Promise<SongResult[]> {
  const plays = await db.play.groupBy({
    by: ["songId"],
    where: { userId, song: { artists: { some: { artistId } } } },
    _count: { songId: true },
    orderBy: { _count: { songId: "desc" } },
    take: 5,
  });
  return songViews(plays.map((p) => p.songId));
}

async function localSongs(artistId: string, userId: string): Promise<SongResult[]> {
  const songs = await db.song.findMany({
    where: { artists: { some: { artistId } } },
    include: { ...SONG_INCLUDE, _count: { select: { plays: { where: { userId } } } } },
    take: 50,
  });
  return songs.sort((a, b) => b._count.plays - a._count.plays || a.title.localeCompare(b.title)).map(songView);
}

function dedupe(songs: SongResult[]): SongResult[] {
  const seen = new Set<string>();
  return songs.filter((s) => !seen.has(s.id) && seen.add(s.id));
}

async function settleIds(ids: string[]): Promise<string[]> {
  return [...new Set(await Promise.all(ids.map((id) => persistQueue.settled(id))))];
}
