import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { warmArtistProfile, type ArtistCard, type StoredProfile } from "../library/catalogue";
import { songViews, type SongResult } from "../library/song-view";
import { getRadio } from "./radio";
import { diversify, weightedSample } from "./score";
import { forgetTaste, loadTaste, top, type Taste } from "./taste";

// The personal half of the home screen. Worked out in the background from
// someone's taste and the radios of what they love, stored as ids, and
// served as stored until it goes stale, so opening the app is two queries.

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const STALE_MS = 4 * HOUR;
const MIN_AGE_MS = 10 * 60_000; // rebuild early after enough new listening, but not constantly
const LISTENS_FOR_REBUILD = 8;
const RADIO_WAIT_MS = 6000;
const SEEDS = 6;

type StoredShelf =
  | { kind: "mix" | "repeat" | "rediscover"; songIds: string[] }
  | { kind: "because"; seedId: string; songIds: string[] }
  | { kind: "artists" | "top-artists"; artistIds: string[] };

export type Shelf =
  | { kind: "mix" | "repeat" | "rediscover"; songs: SongResult[] }
  | { kind: "because"; seed: SongResult; songs: SongResult[] }
  | { kind: "artists" | "top-artists"; artists: ArtistCard[] };

const building = new Map<string, Promise<StoredShelf[]>>();

export async function personalHome(userId: string): Promise<Shelf[]> {
  const stored = await db.homeMix.findUnique({ where: { userId } });
  let shelves: StoredShelf[];
  if (!stored) {
    shelves = await rebuildHome(userId);
  } else {
    shelves = stored.shelves as unknown as StoredShelf[];
    const age = Date.now() - stored.computedAt.getTime();
    const stale =
      age > STALE_MS || (age > MIN_AGE_MS && (await db.listen.count({ where: { userId, at: { gt: stored.computedAt } } })) >= LISTENS_FOR_REBUILD);
    if (stale) void rebuildHome(userId).catch((err) => console.warn(`home: rebuilding for ${userId} failed`, err));
  }
  return hydrate(shelves);
}

export function rebuildHome(userId: string): Promise<StoredShelf[]> {
  let pending = building.get(userId);
  if (!pending) {
    pending = buildHome(userId).finally(() => building.delete(userId));
    building.set(userId, pending);
  }
  return pending;
}

async function buildHome(userId: string): Promise<StoredShelf[]> {
  const started = Date.now();
  forgetTaste(userId);
  const taste = await loadTaste(userId);
  const now = Date.now();
  const lead = (id: string) => taste.songArtists.get(id)?.[0];
  const heardWithin = (id: string, ms: number) => now - (taste.lastHeard.get(id) ?? 0) < ms;

  // Seeds: a weighted pick of what they're into lately, one per artist, so
  // the mix shifts between rebuilds instead of always following the top song.
  const favourites = diversify(top(taste.current, 40, (id, s) => s > 0 && !taste.disliked.has(id)), lead, 15, 1);
  const seeds = weightedSample(favourites.map((id) => ({ item: id, weight: taste.current.get(id)! })), SEEDS);
  const radios = (await Promise.all(seeds.map((id) => getRadio(id, { waitMs: RADIO_WAIT_MS, saved: true })))).map((r) => r.ids);
  const incomplete = radios.some((r) => !r.length);

  // Artists: the ones they love, and who those artists' fans also like.
  const topArtists = top(taste.artists, 12, (_, s) => s > 0);
  const profiles = await db.artist.findMany({ where: { id: { in: topArtists } }, select: { id: true, profile: true } });
  profiles.filter((a) => !a.profile).slice(0, 3).forEach((a) => void warmArtistProfile(a.id).catch(() => {}));
  const relatedVotes = new Map<string, number>();
  for (const a of profiles) {
    const weight = taste.artists.get(a.id) ?? 0;
    ((a.profile as unknown as StoredProfile | null)?.related ?? []).forEach((id, rank) => {
      if ((taste.artists.get(id) ?? 0) > 1) return; // already theirs
      relatedVotes.set(id, (relatedVotes.get(id) ?? 0) + weight / (1 + rank / 4));
    });
  }
  const suggestedArtists = top(relatedVotes, 12);
  const suggestedProfiles = await db.artist.findMany({ where: { id: { in: suggestedArtists.slice(0, 6) } }, select: { id: true, profile: true } });

  // The mix: songs the seeds' radios agree on, plus the best of the
  // suggested artists, that they've never heard.
  const votes = new Map<string, number>();
  const vote = (id: string, v: number) => votes.set(id, (votes.get(id) ?? 0) + v);
  const maxSeed = Math.max(...seeds.map((id) => taste.current.get(id) ?? 0), 1);
  seeds.forEach((seed, i) => {
    const weight = 0.5 + 0.5 * ((taste.current.get(seed) ?? 0) / maxSeed);
    radios[i].forEach((id, rank) => vote(id, weight / (1 + rank / 6)));
  });
  const maxRelated = Math.max(...relatedVotes.values(), 1);
  for (const a of suggestedProfiles) {
    const weight = 0.4 * ((relatedVotes.get(a.id) ?? 0) / maxRelated);
    ((a.profile as unknown as StoredProfile | null)?.popular ?? []).slice(0, 3).forEach((id, rank) => vote(id, weight / (1 + rank)));
  }
  const candidates = [...votes.keys()];
  const leads = await leadArtists(candidates.filter((id) => !taste.songArtists.has(id)));
  const leadOf = (id: string) => lead(id) ?? leads.get(id);
  const fresh = (id: string) => !taste.songs.has(id) && !taste.disliked.has(id);
  const mix = diversify(
    candidates.filter(fresh).sort((a, b) => votes.get(b)! * artistBoost(taste, leadOf(b)) - votes.get(a)! * artistBoost(taste, leadOf(a))),
    leadOf,
    30,
  );

  // "More like": the two strongest seeds' radios, skipping what they just
  // heard and, where there's enough else, what the mix already has.
  const inMix = new Set(mix);
  const because = seeds.slice(0, 2).flatMap((seedId, i): StoredShelf[] => {
    const pool = radios[i].filter((id) => !taste.disliked.has(id) && !heardWithin(id, 2 * DAY));
    const unmixed = pool.filter((id) => !inMix.has(id));
    const songIds = diversify(unmixed.length >= 6 ? unmixed : pool, leadOf, 12);
    return songIds.length >= 6 ? [{ kind: "because", seedId, songIds }] : [];
  });

  // Familiar: what's on repeat this month, and loved songs gone quiet.
  const repeat = diversify(top(taste.current, 40, (id, s) => s > 1.5 && heardWithin(id, 30 * DAY)), lead, 12, 3);
  const quiet = top(taste.songs, 120, (id, s) => s >= 2.5 && !heardWithin(id, 30 * DAY));
  const rediscover = diversify(weightedSample(quiet.map((id) => ({ item: id, weight: taste.songs.get(id)! })), 40), lead, 12);

  const shelves: StoredShelf[] = [];
  if (mix.length >= 6) shelves.push({ kind: "mix", songIds: mix });
  if (because[0]) shelves.push(because[0]);
  if (suggestedArtists.length >= 4) shelves.push({ kind: "artists", artistIds: suggestedArtists });
  if (repeat.length >= 4) shelves.push({ kind: "repeat", songIds: repeat });
  if (because[1]) shelves.push(because[1]);
  if (rediscover.length >= 4) shelves.push({ kind: "rediscover", songIds: rediscover });
  const yourArtists = topArtists.filter((id) => (taste.artists.get(id) ?? 0) > 1.5);
  if (yourArtists.length >= 4) shelves.push({ kind: "top-artists", artistIds: yourArtists });

  // Built without some radios (still fetching): come back for them soon.
  const computedAt = new Date(incomplete ? Date.now() - STALE_MS + MIN_AGE_MS : Date.now());
  const data = { shelves: shelves as unknown as Prisma.InputJsonValue, computedAt };
  await db.homeMix.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  console.info(`home: built for ${userId} in ${Date.now() - started}ms (${seeds.length} seeds, ${votes.size} candidates${incomplete ? ", some radios pending" : ""})`);
  return shelves;
}

// Leans towards artists they like and away from ones they skip.
function artistBoost(taste: Taste, artistId: string | undefined): number {
  const a = artistId ? (taste.artists.get(artistId) ?? 0) : 0;
  return a < -1 ? 0.4 : 1 + 0.2 * Math.tanh(a / 6);
}

export async function leadArtists(songIds: string[]): Promise<Map<string, string>> {
  if (!songIds.length) return new Map();
  const rows = await db.songArtist.findMany({ where: { songId: { in: songIds } }, select: { songId: true, artistId: true }, orderBy: { position: "asc" } });
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.songId)) out.set(r.songId, r.artistId);
  return out;
}

async function hydrate(shelves: StoredShelf[]): Promise<Shelf[]> {
  const songIds = [...new Set(shelves.flatMap((s) => ("songIds" in s ? [...s.songIds, ...("seedId" in s ? [s.seedId] : [])] : [])))];
  const artistIds = [...new Set(shelves.flatMap((s) => ("artistIds" in s ? s.artistIds : [])))];
  const [songs, artists] = await Promise.all([
    songViews(songIds),
    artistIds.length ? db.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, name: true, imageUrl: true } }) : [],
  ]);
  const songById = new Map(songs.map((s) => [s.id, s]));
  const artistById = new Map(artists.map((a) => [a.id, { id: a.id, name: a.name, imageUrl: a.imageUrl ?? undefined }]));
  const songsOf = (ids: string[]) => ids.flatMap((id) => songById.get(id) ?? []);
  return shelves.flatMap((s): Shelf[] => {
    switch (s.kind) {
      case "artists":
      case "top-artists":
        return [{ kind: s.kind, artists: s.artistIds.flatMap((id) => artistById.get(id) ?? []) }];
      case "because": {
        const seed = songById.get(s.seedId);
        return seed ? [{ kind: "because", seed, songs: songsOf(s.songIds) }] : [];
      }
      default:
        return [{ kind: s.kind, songs: songsOf(s.songIds) }];
    }
  });
}
