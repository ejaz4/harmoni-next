import type { Spice } from "@/generated/prisma/client";
import { db } from "../db";
import { NotFound } from "../library/service";
import { songViews, type SongResult } from "../library/song-view";
import { normalizeText } from "../matching/normalize";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { Collection, SongCandidate } from "../providers/types";
import { persistQueue } from "../search/persist-queue";
import { resolveCandidates } from "../search/service";
import { getRadio, lookUp } from "./radio";
import { diversify, weightedSample } from "./score";
import { loadTaste, type Taste } from "./taste";

// Spices: playlists the algorithm fills. A search Spice ("K-Pop") starts
// from providers' curated collections for that genre or mood; a person's
// own Spice starts from songs they pick as seeds. Either way the songs are
// chosen for whoever opens it (with Super Processing, from their taste),
// and remade at most once a day, only when they open it or play from it.

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MIX_SIZE = 50;
const PER_ARTIST = 3;
const POOL_REFRESH_MS = 7 * DAY;
const POOL_PER_COLLECTION = 100;
const MAX_COLLECTIONS = 3;
const FIND_DEADLINE_MS = 3000;
const PROVIDER_DEADLINE_MS = 10_000;
const RADIO_WAIT_MS = 6000;
const STALE_WAIT_MS = 4000; // a day-old mix is shown if today's takes longer than this
const EXPAND_SEEDS = 4;
const SEARCH_CACHE_MS = 6 * HOUR;

export interface SpiceCard {
  id: string;
  name: string;
  kind: "search" | "custom";
  covers: string[]; // artwork from inside, for the cover's colours
  seedCount?: number;
  updatedAt: string;
}

export interface SpicePage extends SpiceCard {
  owned: boolean;
  songs: SongResult[];
  seeds: SongResult[];
  generatedAt?: string;
}

type User = { id: string; superProcessing: boolean };
// Matched songs, some maybe not saved yet (like search results, playable straight away).
type Fresh = Map<string, SongResult>;

// --- Finding search Spices ---

const searchCache = new Map<string, { at: number; card: SpiceCard | null }>();

// The Spice for a search, if the query names a genre, mood or scene that
// providers keep curated collections of. Cheap after the first time.
export async function findSearchSpice(query: string): Promise<SpiceCard | null> {
  // "k-pop", "K Pop" and "kpop" are one Spice.
  const queryKey = normalizeText(query).replace(/ /g, "");
  if (queryKey.length < 2 || queryKey.length > 40) return null;
  const cached = searchCache.get(queryKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.card;

  let spice = await db.spice.findUnique({ where: { queryKey } });
  if (!spice) {
    const providers = getRegistry().withRole("discovery").filter((p) => p.discovery!.findCollections);
    const found = (
      await Promise.all(
        providers.map((p) => withDeadline(p.discovery!.findCollections!(query), FIND_DEADLINE_MS, p.prefix).catch((): Collection[] => [])),
      )
    ).flat();
    if (found.length) {
      const data = { name: prettyName(query, found[0].title), queryKey, sources: found.slice(0, MAX_COLLECTIONS + 1).map((c) => c.source) };
      spice = await db.spice.upsert({ where: { queryKey }, create: data, update: {} });
    }
  }
  const card = spice ? await toCard(spice) : null;
  if (searchCache.size > 1000) searchCache.clear();
  searchCache.set(queryKey, { at: Date.now(), card });
  return card;
}

// The way the collection writes it ("kpop" → "K-Pop"), else title case.
export function prettyName(query: string, title: string): string {
  const key = (t: string) => normalizeText(t).replace(/ /g, "");
  const q = key(query);
  const words = [...title.matchAll(/\S+/g)];
  let name = query.trim();
  for (let i = 0; i < words.length && name === query.trim(); i++) {
    for (let j = i; j < words.length; j++) {
      const slice = title.slice(words[i].index, words[j].index! + words[j][0].length).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (key(slice) === q) {
        name = slice;
        break;
      }
    }
  }
  return name === name.toLowerCase() ? name.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase()) : name;
}

// --- People's own Spices ---

export async function listSpices(userId: string): Promise<SpiceCard[]> {
  const spices = await db.spice.findMany({ where: { ownerId: userId }, orderBy: { updatedAt: "desc" } });
  return Promise.all(spices.map((s) => toCard(s, userId)));
}

export async function createSpice(userId: string, name: string, seedId?: string): Promise<SpiceCard> {
  const songId = seedId ? await persistQueue.settled(seedId) : undefined;
  if (songId && !(await db.song.findUnique({ where: { id: songId }, select: { id: true } }))) throw new NotFound();
  const spice = await db.spice.create({ data: { ownerId: userId, name, seeds: songId ? { create: { songId } } : undefined } });
  return toCard(spice, userId);
}

async function ownSpice(userId: string, spiceId: string): Promise<Spice> {
  const spice = await db.spice.findFirst({ where: { id: spiceId, ownerId: userId } });
  if (!spice) throw new NotFound();
  return spice;
}

export async function renameSpice(userId: string, spiceId: string, name: string) {
  await ownSpice(userId, spiceId);
  await db.spice.update({ where: { id: spiceId }, data: { name } });
}

export async function deleteSpice(userId: string, spiceId: string) {
  await ownSpice(userId, spiceId);
  await db.spice.delete({ where: { id: spiceId } });
}

// Changing the seeds remakes the mix next time it's opened, whatever the day.
export async function addSeed(userId: string, spiceId: string, requestedId: string) {
  await ownSpice(userId, spiceId);
  const songId = await persistQueue.settled(requestedId);
  if (!(await db.song.findUnique({ where: { id: songId }, select: { id: true } }))) throw new NotFound();
  await db.$transaction([
    db.spiceSeed.upsert({ where: { spiceId_songId: { spiceId, songId } }, create: { spiceId, songId }, update: {} }),
    db.spice.update({ where: { id: spiceId }, data: { updatedAt: new Date() } }),
  ]);
}

export async function removeSeed(userId: string, spiceId: string, songId: string) {
  await ownSpice(userId, spiceId);
  await db.$transaction([
    db.spiceSeed.deleteMany({ where: { spiceId, songId } }),
    db.spice.update({ where: { id: spiceId }, data: { updatedAt: new Date() } }),
  ]);
}

// Today's songs, kept as an ordinary playlist that won't change.
export async function snapshotSpice(user: User, spiceId: string): Promise<{ id: string; name: string }> {
  const page = await getSpicePage(spiceId, user);
  const ids = [...new Set(await Promise.all(page.songs.map((s) => persistQueue.settled(s.id))))];
  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const playlist = await db.playlist.create({
    data: {
      ownerId: user.id,
      name: `${page.name} Spice, ${day}`.slice(0, 100),
      description: `A snapshot of the ${page.name} Spice.`,
      items: { create: ids.map((songId, position) => ({ songId, position })) },
    },
  });
  return { id: playlist.id, name: playlist.name };
}

// --- Opening one ---

const generating = new Map<string, Promise<{ ids: string[]; fresh: Fresh }>>();
// Songs from the latest mixes as matched, while they're still being saved
// in the background, so opening one again straight away shows them all.
const recentlyMade = new Map<string, { at: number; fresh: Fresh }>();
const RECENT_MS = 15 * 60_000;

export async function getSpicePage(spiceId: string, user: User): Promise<SpicePage> {
  const spice = await db.spice.findUnique({ where: { id: spiceId }, include: { seeds: { orderBy: { addedAt: "asc" }, select: { songId: true } } } });
  if (!spice || (spice.ownerId && spice.ownerId !== user.id)) throw new NotFound();
  const seedIds = spice.seeds.map((s) => s.songId);
  const mix = await db.spiceMix.findUnique({ where: { spiceId_userId: { spiceId, userId: user.id } } });

  let ids = mix?.songIds ?? [];
  const recent = recentlyMade.get(`${spiceId}:${user.id}`);
  let fresh: Fresh | undefined = recent && Date.now() - recent.at < RECENT_MS ? recent.fresh : undefined;
  let generatedAt = mix?.generatedAt;
  const stale = !mix || mix.generatedAt.getTime() < Date.now() - DAY || spice.updatedAt > mix.generatedAt;
  if (stale && (spice.queryKey || seedIds.length)) {
    const pending = regenerate(spice, seedIds, user);
    const made = mix ? await Promise.race([pending, new Promise<undefined>((r) => setTimeout(r, STALE_WAIT_MS))]) : await pending;
    if (made) ({ ids, fresh } = made);
    if (made) generatedAt = new Date();
  }

  const [saved, seeds] = await Promise.all([songViews(ids), songViews(seedIds)]);
  const byId = new Map(saved.map((s) => [s.id, s]));
  const songs = ids.flatMap((id) => byId.get(id) ?? fresh?.get(id) ?? []);
  return {
    id: spice.id,
    name: spice.name,
    kind: spice.ownerId ? "custom" : "search",
    covers: covers(songs.length ? songs : seeds),
    updatedAt: spice.updatedAt.toISOString(),
    seedCount: spice.ownerId ? seedIds.length : undefined,
    owned: spice.ownerId === user.id,
    songs,
    seeds,
    generatedAt: generatedAt?.toISOString(),
  };
}

function regenerate(spice: Spice, seedIds: string[], user: User): Promise<{ ids: string[]; fresh: Fresh }> {
  const key = `${spice.id}:${user.id}`;
  let pending = generating.get(key);
  if (!pending) {
    pending = generate(spice, seedIds, user)
      .then(async (made) => {
        const data = { songIds: made.ids, generatedAt: new Date() };
        for (const [k, v] of recentlyMade) if (Date.now() - v.at > RECENT_MS) recentlyMade.delete(k);
        recentlyMade.set(key, { at: Date.now(), fresh: made.fresh });
        await db.spiceMix.upsert({ where: { spiceId_userId: { spiceId: spice.id, userId: user.id } }, create: { spiceId: spice.id, userId: user.id, ...data }, update: data });
        // New songs get saved in the background; store their final ids once they have been.
        void Promise.all(made.ids.map((id) => persistQueue.settled(id, { background: true })))
          .then((settled) => db.spiceMix.updateMany({ where: { spiceId: spice.id, userId: user.id, generatedAt: data.generatedAt }, data: { songIds: [...new Set(settled)] } }))
          .catch(() => {});
        return made;
      })
      .finally(() => generating.delete(key));
    generating.set(key, pending);
  }
  return pending;
}

// --- Making the mix ---

async function generate(spice: Spice, seedIds: string[], user: User): Promise<{ ids: string[]; fresh: Fresh }> {
  const started = Date.now();
  const random = seededRandom(`${spice.id}:${user.id}:${new Date().toISOString().slice(0, 10)}`);
  const taste = user.superProcessing ? await loadTaste(user.id) : undefined;
  const fresh: Fresh = new Map();
  const votes = new Map<string, number>();
  const vote = (id: string, v: number) => votes.set(id, (votes.get(id) ?? 0) + v);

  // Where it starts: the genre's curated songs, or the person's seeds.
  let starts: string[];
  let genreArtists: Set<string> | undefined;
  if (spice.queryKey) {
    const pool = await getPool(spice);
    pool.fresh.forEach((v, k) => fresh.set(k, v));
    pool.ids.forEach((id, rank) => vote(id, 1 / (1 + rank / 30)));
    const leads = await leadNames(pool.ids, fresh);
    // Radios wander out of the genre; only their songs by its artists count.
    genreArtists = new Set(leads.values());
    const top = pool.ids.slice(0, 40);
    starts = weightedSample(top.map((id) => ({ item: id, weight: 1 + Math.max(0, affinity(taste, id)) })), EXPAND_SEEDS, random);
  } else {
    seedIds.forEach((id) => vote(id, 0.5));
    starts = seedIds.length <= EXPAND_SEEDS + 1 ? seedIds : weightedSample(seedIds.map((id) => ({ item: id, weight: 1 })), EXPAND_SEEDS + 1, random);
  }

  // Then out from there, along each start's radio.
  const radios = await Promise.all(starts.map((id) => getRadio(id, { waitMs: RADIO_WAIT_MS })));
  radios.forEach((r) => r.fresh?.forEach((v, k) => fresh.set(k, v)));
  const candidates = [...new Set([...votes.keys(), ...radios.flatMap((r) => r.ids)])];
  const leads = await leadNames(candidates, fresh);
  radios.forEach((r) =>
    r.ids.forEach((id, rank) => {
      if (genreArtists && !genreArtists.has(leads.get(id) ?? "")) return;
      vote(id, 0.8 / (1 + rank / 6));
    }),
  );

  // For this person: their taste leads, a little shuffle so each day differs.
  const score = (id: string) => {
    let s = votes.get(id)! * (0.8 + 0.4 * random());
    if (!taste) return s;
    s *= 1 + 0.12 * Math.max(-3, Math.min(taste.songs.get(id) ?? 0, 8));
    const artist = taste.artists.get(taste.songArtists.get(id)?.[0] ?? "") ?? 0;
    return s * (artist < -1 ? 0.5 : 1 + 0.15 * Math.tanh(artist / 6));
  };
  const ranked = [...votes.keys()].filter((id) => !taste?.disliked.has(id)).map((id) => ({ id, s: score(id) }));
  ranked.sort((a, b) => b.s - a.s);
  const ids = diversify(
    ranked.map((r) => r.id),
    (id) => leads.get(id),
    MIX_SIZE,
    PER_ARTIST,
  );
  console.info(`spice: made "${spice.name}" for ${user.id} in ${Date.now() - started}ms (${starts.length} starts, ${votes.size} candidates)`);
  return { ids, fresh };
}

const affinity = (taste: Taste | undefined, songId: string) => (taste ? (taste.songs.get(songId) ?? 0) + 0.3 * (taste.artists.get(taste.songArtists.get(songId)?.[0] ?? "") ?? 0) : 0);

// Each song's lead artist, by name: songs not saved yet have no artist ids.
async function leadNames(ids: string[], fresh: Fresh): Promise<Map<string, string>> {
  const credits = await db.songArtist.findMany({ where: { songId: { in: ids } }, orderBy: { position: "asc" }, select: { songId: true, artist: { select: { name: true } } } });
  const out = new Map<string, string>();
  for (const c of credits) if (!out.has(c.songId)) out.set(c.songId, normalizeText(c.artist.name));
  for (const id of ids) {
    const name = fresh.get(id)?.artists[0]?.name;
    if (!out.has(id) && name) out.set(id, normalizeText(name));
  }
  return out;
}

// A search Spice's songs: its collections' tracks, matched, interleaved so
// each collection is near the top. Shared, refreshed weekly.
const building = new Map<string, Promise<{ ids: string[]; fresh: Fresh }>>();

async function getPool(spice: Spice): Promise<{ ids: string[]; fresh: Fresh }> {
  const due = !spice.poolRefreshAfter || spice.poolRefreshAfter <= new Date();
  if (spice.poolIds.length && !due) return { ids: spice.poolIds, fresh: new Map() };
  let pending = building.get(spice.id);
  if (!pending) {
    pending = buildPool(spice).finally(() => building.delete(spice.id));
    building.set(spice.id, pending);
  }
  if (spice.poolIds.length) {
    void pending.catch(() => {});
    return { ids: spice.poolIds, fresh: new Map() };
  }
  return pending;
}

async function buildPool(spice: Spice): Promise<{ ids: string[]; fresh: Fresh }> {
  const registry = getRegistry();
  const lists = await Promise.all(
    spice.sources.slice(0, MAX_COLLECTIONS + 1).map(async (source) => {
      const plugin = registry.get(source.slice(0, source.indexOf(":")));
      const discovery = plugin?.discovery;
      if (!plugin || !discovery?.collectionSongs) return [];
      try {
        const songs = await withDeadline(discovery.collectionSongs(source), PROVIDER_DEADLINE_MS, plugin.prefix);
        return discovery.textOnly ? await lookUp(songs.slice(0, 15)) : songs.slice(0, POOL_PER_COLLECTION);
      } catch (err) {
        console.warn(`spice: ${source} failed`, err);
        return [];
      }
    }),
  );
  const resolved = await resolveCandidates(lists, { lane: "later" });
  const interleaved: SongCandidate[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) interleaved.push(l[i]);
  const ids = [...new Set(interleaved.flatMap((c) => resolved.get(c.source)?.id ?? []))];
  const fresh: Fresh = new Map([...resolved.values()].map((v) => [v.id, v]));

  // Stored once every song is saved; refreshed sooner if nothing came back.
  void Promise.all(ids.map((id) => persistQueue.settled(id, { background: true })))
    .then((settled) =>
      db.spice.update({
        where: { id: spice.id },
        data: { poolIds: [...new Set(settled)], poolRefreshAfter: new Date(Date.now() + (settled.length ? POOL_REFRESH_MS : DAY)) },
      }),
    )
    .catch((err) => console.warn(`spice: storing pool for "${spice.name}" failed`, err));
  return { ids, fresh };
}

// --- Helpers ---

async function toCard(spice: Spice, userId?: string): Promise<SpiceCard> {
  const mix = userId ? await db.spiceMix.findUnique({ where: { spiceId_userId: { spiceId: spice.id, userId } }, select: { songIds: true } }) : null;
  const seeds = spice.ownerId ? await db.spiceSeed.findMany({ where: { spiceId: spice.id }, select: { songId: true } }) : [];
  const ids = (mix?.songIds.length ? mix.songIds : spice.ownerId ? seeds.map((s) => s.songId) : spice.poolIds).slice(0, 12);
  const songs = ids.length ? await db.song.findMany({ where: { id: { in: ids } }, select: { id: true, artworkUrl: true } }) : [];
  const order = new Map(ids.map((id, i) => [id, i]));
  return {
    id: spice.id,
    name: spice.name,
    kind: spice.ownerId ? "custom" : "search",
    covers: covers(songs.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((s) => ({ artworkUrl: s.artworkUrl ?? undefined }))),
    seedCount: spice.ownerId ? seeds.length : undefined,
    updatedAt: spice.updatedAt.toISOString(),
  };
}

const covers = (songs: { artworkUrl?: string }[]) => [...new Set(songs.flatMap((s) => (s.artworkUrl ? [s.artworkUrl] : [])))].slice(0, 3);

// Same sequence for the same seed: a Spice holds still for the day.
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
