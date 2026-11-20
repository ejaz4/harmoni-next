import type { Spice } from "@/generated/prisma/client";
import { artUrls } from "../artwork";
import { spiceName } from "@/lib/spice-name";
import { db } from "../db";
import { likedSongs, NotFound, recentSongs } from "../library/service";
import { songViews, type SongResult } from "../library/song-view";
import { normalizeText } from "../matching/normalize";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { Collection, SongCandidate } from "../providers/types";
import { persistQueue } from "../search/persist-queue";
import { resolveCandidates } from "../search/service";
import { dailyName, dailyPool, dayPart, pickSource, searchSources, STARTER_SEARCHES, type DayPart } from "./daily";
import { getRadio, lookUp } from "./radio";
import { diversify, weightedSample } from "./score";
import { loadTaste, top, type Taste } from "./taste";

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
export const MAX_SEEDS = 50;
const SUGGESTIONS = 30;
const SUGGESTIONS_PER_ARTIST = 2;

export interface SpiceCard {
  id: string;
  name: string;
  // Apps only know two kinds: ones you made ("custom") and ones you can
  // open but not change ("search"). The Daily Spice is the second sort.
  kind: "search" | "custom";
  daily?: { part: string; endsAt: string }; // set on their Daily Spice: "Morning", and when it changes next
  covers: string[]; // artwork from inside, for the cover's colours
  seedCount?: number;
  autoNamed?: boolean; // named after its seeds, not by them
  updatedAt: string;
}

export interface SpicePage extends SpiceCard {
  owned: boolean;
  songs: SongResult[];
  seeds: SongResult[];
  generatedAt?: string;
  expiresAt?: string; // when opening it next makes a new one
  daily?: {
    part: string; // "Morning"
    endsAt: string; // when it changes next
    source?: { id: string; name: string }; // the search Spice in it now
    needsSuperProcessing?: boolean;
  };
}

type User = { id: string; superProcessing: boolean; name?: string };
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

// Their Daily Spice comes first (with Super Processing on), so apps made
// before it existed still show it at the top. Apps that give it a place of
// its own ask without it.
export async function listSpices(user: User, { daily = true } = {}): Promise<SpiceCard[]> {
  const spices = await db.spice.findMany({ where: { ownerId: user.id, kind: null }, orderBy: { updatedAt: "desc" } });
  const first = daily && user.superProcessing ? [(await dailySpice(user)).spice] : [];
  return Promise.all([...first, ...spices].map((s) => toCard(s, user.id)));
}

// Made from the songs picked as seeds. Without a name it's named after
// them, and keeps up as they change until someone renames it.
export async function createSpice(userId: string, { name, seedIds = [] }: { name?: string; seedIds?: string[] }): Promise<SpiceCard> {
  const songIds = await existingSongs(seedIds);
  if (seedIds.length && !songIds.length) throw new NotFound();
  const now = Date.now();
  const spice = await db.spice.create({
    data: {
      ownerId: userId,
      name: name ?? spiceName(await songViews(songIds)),
      autoNamed: !name,
      // A millisecond apart, so they keep the order they were picked in.
      seeds: { create: songIds.map((songId, i) => ({ songId, addedAt: new Date(now + i) })) },
    },
  });
  return toCard(spice, userId);
}

// Search results may not be saved yet: their ids once they are, that exist.
async function existingSongs(ids: string[]): Promise<string[]> {
  const settled = [...new Set(await Promise.all(ids.slice(0, MAX_SEEDS).map((id) => persistQueue.settled(id))))];
  const found = new Set((await db.song.findMany({ where: { id: { in: settled } }, select: { id: true } })).map((s) => s.id));
  return settled.filter((id) => found.has(id));
}

async function ownSpice(userId: string, spiceId: string): Promise<Spice> {
  // The Daily Spice looks after itself: no renaming, seeds or deleting.
  const spice = await db.spice.findFirst({ where: { id: spiceId, ownerId: userId, kind: null } });
  if (!spice) throw new NotFound();
  return spice;
}

// Without a name, it's named after its songs again.
export async function renameSpice(userId: string, spiceId: string, name: string | undefined) {
  await ownSpice(userId, spiceId);
  await db.spice.update({ where: { id: spiceId }, data: name ? { name, autoNamed: false } : { autoNamed: true } });
  if (!name) await seedsChanged(spiceId);
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
  await db.spiceSeed.upsert({ where: { spiceId_songId: { spiceId, songId } }, create: { spiceId, songId }, update: {} });
  await seedsChanged(spiceId);
}

export async function removeSeed(userId: string, spiceId: string, songId: string) {
  await ownSpice(userId, spiceId);
  await db.spiceSeed.deleteMany({ where: { spiceId, songId } });
  await seedsChanged(spiceId);
}

// All its seeds at once, in this order.
export async function setSeeds(userId: string, spiceId: string, requestedIds: string[]) {
  await ownSpice(userId, spiceId);
  const songIds = await existingSongs(requestedIds);
  const now = Date.now();
  await db.$transaction([
    db.spiceSeed.deleteMany({ where: { spiceId } }),
    db.spiceSeed.createMany({ data: songIds.map((songId, i) => ({ spiceId, songId, addedAt: new Date(now + i) })) }),
  ]);
  await seedsChanged(spiceId);
}

async function seedsChanged(spiceId: string) {
  const spice = await db.spice.findUnique({ where: { id: spiceId }, include: { seeds: { orderBy: { addedAt: "asc" }, select: { songId: true } } } });
  if (!spice) return;
  const name = spice.autoNamed && spice.seeds.length ? spiceName(await songViews(spice.seeds.map((s) => s.songId))) : undefined;
  await db.spice.update({ where: { id: spiceId }, data: { updatedAt: new Date(), ...(name ? { name } : {}) } });
}

// Songs to pick seeds from before searching: what they've had on lately,
// then what they've played and liked, a couple per artist.
export async function seedSuggestions(user: User): Promise<SongResult[]> {
  const favourites = user.superProcessing
    ? await loadTaste(user.id).then(async (taste) => songViews(top(taste.current, SUGGESTIONS * 2, (id) => !taste.disliked.has(id))))
    : [];
  const [recent, liked] = await Promise.all([recentSongs(user.id, SUGGESTIONS), likedSongs(user.id, SUGGESTIONS)]);
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const picked: SongResult[] = [];
  for (const song of [...favourites, ...recent, ...liked]) {
    const artist = song.artists[0]?.name.toLowerCase() ?? "";
    if (seen.has(song.id) || (perArtist.get(artist) ?? 0) >= SUGGESTIONS_PER_ARTIST) continue;
    seen.add(song.id);
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    picked.push(song);
    if (picked.length >= SUGGESTIONS) break;
  }
  return picked;
}

// Today's songs, kept as an ordinary playlist that won't change.
export async function snapshotSpice(user: User, spiceId: string): Promise<{ id: string; name: string }> {
  const page = await getSpicePage(spiceId, user);
  const ids = [...new Set(await Promise.all(page.songs.map((s) => persistQueue.settled(s.id))))];
  const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const playlist = await db.playlist.create({
    data: {
      ownerId: user.id,
      name: `${/ Spice$/.test(page.name) ? page.name : `${page.name} Spice`}, ${day}`.slice(0, 100),
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

// "daily" is the person's own Daily Spice, made the first time they open it.
export async function getSpicePage(requestedId: string, user: User): Promise<SpicePage> {
  const daily = requestedId === DAILY ? await dailySpice(user) : undefined;
  const spiceId = daily?.spice.id ?? requestedId;
  const spice = await db.spice.findUnique({ where: { id: spiceId }, include: { seeds: { orderBy: { addedAt: "asc" }, select: { songId: true } } } });
  if (!spice || (spice.ownerId && spice.ownerId !== user.id)) throw new NotFound();
  const part = spice.kind === "daily" ? (daily?.part ?? dayPart(new Date(), (await timeZoneOf(user.id)))) : undefined;
  const dailyInfo = part && {
    ...partInfo(part),
    source: await currentSource(spice),
    needsSuperProcessing: !user.superProcessing || undefined,
  };
  if (part && !user.superProcessing) {
    return { ...pageBase(spice, user, [], []), name: dailyName(user.name ?? "", part), daily: dailyInfo };
  }
  const seedIds = spice.seeds.map((s) => s.songId);
  const mix = await db.spiceMix.findUnique({ where: { spiceId_userId: { spiceId, userId: user.id } } });

  let ids = mix?.songIds ?? [];
  const recent = recentlyMade.get(`${spiceId}:${user.id}`);
  let fresh: Fresh | undefined = recent && Date.now() - recent.at < RECENT_MS ? recent.fresh : undefined;
  let generatedAt = mix?.generatedAt;
  const stale = part
    ? !mix || mix.slot !== part.slot
    : !mix || mix.generatedAt.getTime() < Date.now() - DAY || spice.updatedAt > mix.generatedAt;
  if (stale && (spice.queryKey || seedIds.length || part)) {
    const pending = regenerate(spice, seedIds, user, part);
    const made = mix ? await Promise.race([pending, new Promise<undefined>((r) => setTimeout(r, STALE_WAIT_MS))]) : await pending;
    if (made) ({ ids, fresh } = made);
    if (made) generatedAt = new Date();
  }

  const [saved, seeds] = await Promise.all([songViews(ids), songViews(seedIds)]);
  const byId = new Map(saved.map((s) => [s.id, s]));
  const songs = ids.flatMap((id) => byId.get(id) ?? fresh?.get(id) ?? []);
  // A Daily Spice renames itself as it remakes, so read the name again.
  const current = (part && (await db.spice.findUnique({ where: { id: spice.id } }))) || spice;
  return {
    ...pageBase(current, user, songs, seeds),
    generatedAt: generatedAt?.toISOString(),
    expiresAt: part ? part.endsAt.toISOString() : generatedAt && new Date(generatedAt.getTime() + DAY).toISOString(),
    daily: part && { ...dailyInfo!, source: await currentSource(current) },
  };
}

function pageBase(spice: Spice, user: User, songs: SongResult[], seeds: SongResult[]): SpicePage {
  return {
    id: spice.id,
    name: spice.name,
    kind: kindOf(spice),
    covers: covers(songs.length ? songs : seeds),
    updatedAt: spice.updatedAt.toISOString(),
    seedCount: kindOf(spice) === "custom" ? seeds.length : undefined,
    autoNamed: kindOf(spice) === "custom" ? spice.autoNamed : undefined,
    owned: kindOf(spice) === "custom" && spice.ownerId === user.id,
    songs,
    seeds,
  };
}

const kindOf = (spice: Spice): SpiceCard["kind"] => (spice.ownerId && !spice.kind ? "custom" : "search");

function regenerate(spice: Spice, seedIds: string[], user: User, part?: DayPart): Promise<{ ids: string[]; fresh: Fresh }> {
  const key = `${spice.id}:${user.id}`;
  let pending = generating.get(key);
  if (!pending) {
    pending = generate(spice, seedIds, user, part)
      .then(async (made) => {
        const data = { songIds: made.ids, generatedAt: new Date(), slot: part?.slot ?? null };
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

async function generate(spice: Spice, seedIds: string[], user: User, part?: DayPart): Promise<{ ids: string[]; fresh: Fresh }> {
  const started = Date.now();
  const random = seededRandom(`${spice.id}:${user.id}:${new Date().toISOString().slice(0, 10)}`);
  const taste = user.superProcessing ? await loadTaste(user.id) : undefined;
  const fresh: Fresh = new Map();
  const votes = new Map<string, number>();
  const vote = (id: string, v: number) => votes.set(id, (votes.get(id) ?? 0) + v);

  // Where it starts: the genre's curated songs, the person's seeds, or
  // (Daily) what they play at this time of day plus a search Spice to match.
  let starts: string[];
  let genreArtists: Set<string> | undefined;
  if (part) {
    const daily = await dailyPool(user.id, await timeZoneOf(user.id), part.key, taste!); // Daily Spices need Super Processing
    const source = await pickSource(daily, spice.sources[0]);
    daily.ids.forEach((id, rank) => vote(id, 1 / (1 + rank / 20)));
    let fromSource: string[] = [];
    if (source) {
      const known = new Set(daily.leads.values());
      // Its songs by artists they already play first, so it fits them.
      source.poolIds.forEach((id, rank) => vote(id, (0.6 / (1 + rank / 40)) * (known.has(source.leads.get(id) ?? "") ? 1.5 : 1)));
      fromSource = weightedSample(source.poolIds.slice(0, 40).map((id) => ({ item: id, weight: 1 })), 2, random);
    }
    await db.spice.update({ where: { id: spice.id }, data: { name: dailyName(user.name ?? "", part, source?.name), sources: source ? [source.id] : [] } });
    starts = [...weightedSample(daily.ids.slice(0, 30).map((id) => ({ item: id, weight: daily.weights.get(id) ?? 1 })), EXPAND_SEEDS - 1, random), ...fromSource];
    if ((await searchSources()).length < STARTER_SEARCHES.length) void warmStarters();
  } else if (spice.queryKey) {
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
    kind: kindOf(spice),
    daily: spice.kind === "daily" && userId ? partInfo(dayPart(new Date(), await timeZoneOf(userId))) : undefined,
    covers: covers(songs.sort((a, b) => order.get(a.id)! - order.get(b.id)!).map((s) => ({ artworkUrl: s.artworkUrl ?? undefined }))),
    seedCount: kindOf(spice) === "custom" ? seeds.length : undefined,
    autoNamed: kindOf(spice) === "custom" ? spice.autoNamed : undefined,
    updatedAt: spice.updatedAt.toISOString(),
  };
}

const covers = (songs: { artworkUrl?: string }[]) => [...new Set(artUrls(songs.map((s) => s.artworkUrl)))].slice(0, 3);

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

// --- The Daily Spice ---

export const DAILY = "daily";

async function dailySpice(user: User): Promise<{ spice: Spice; part: DayPart }> {
  const part = dayPart(new Date(), await timeZoneOf(user.id));
  const name = dailyName(user.name ?? "", part);
  const spice = await db.spice.upsert({
    where: { ownerId_kind: { ownerId: user.id, kind: "daily" } },
    create: { ownerId: user.id, kind: "daily", name },
    update: {},
  });
  return { spice, part };
}

const partInfo = (part: DayPart) => ({ part: part.label, endsAt: part.endsAt.toISOString() });

async function timeZoneOf(userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return u?.timeZone ?? process.env.TZ ?? "UTC";
}

async function currentSource(spice: Spice): Promise<{ id: string; name: string } | undefined> {
  const id = spice.kind === "daily" ? spice.sources[0] : undefined;
  return id ? (await db.spice.findUnique({ where: { id }, select: { id: true, name: true } })) ?? undefined : undefined;
}

// Makes the starter search Spices and their pools, once, in the background.
let warming: Promise<void> | undefined;
function warmStarters(): Promise<void> {
  warming ??= (async () => {
    for (const query of STARTER_SEARCHES) {
      try {
        const card = await findSearchSpice(query);
        const spice = card && (await db.spice.findUnique({ where: { id: card.id } }));
        if (spice && !spice.poolIds.length) await getPool(spice);
      } catch (err) {
        console.warn(`spice: warming "${query}" failed`, err);
      }
    }
  })();
  return warming;
}
