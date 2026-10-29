import { db } from "../db";
import { compare, prepare } from "../matching/matcher";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { DiscoverySeed, ProviderPlugin, SongCandidate } from "../providers/types";
import type { SongResult } from "../library/song-view";
import { persistQueue } from "../search/persist-queue";
import { resolveCandidates } from "../search/service";

// A song's radio: the songs that go with it, from every discovery provider
// at once (YouTube Music's up next, Deezer's artist radio, Last.fm's similar
// tracks), matched into canonical songs. Shared by everyone and cached like
// artist pages: served as stored, rebuilt in the background when due.

const DAY = 24 * 60 * 60_000;
const REFRESH_MS = 14 * DAY;
const RETRY_EMPTY_MS = DAY;
const PROVIDER_DEADLINE_MS = 10_000;
const PER_PROVIDER = 25;
const TEXT_LOOKUPS = 12; // Last.fm suggestions looked up per radio
const MAX_BUILDS = 3; // at once, across everyone
const LOOKUP_CONCURRENCY = 3;

export interface Radio {
  ids: string[]; // best first
  // A radio built just now: its songs as matched, some maybe not saved yet
  // (like search results, they can be played and liked straight away).
  fresh?: Map<string, SongResult>;
}

interface Build {
  matched: Promise<Radio>; // as soon as matching is done
  stored: Promise<string[]>; // once every song is saved and the radio stored
}

const building = new Map<string, Build>();
const waiting: (() => void)[] = [];
let running = 0;
const NONE: Radio = { ids: [] };

// The songs that go with this one. Waits up to `waitMs` for a radio that
// hasn't been built yet (0: don't wait, build it for next time). `saved`
// waits for its songs to be saved too, for callers that store the ids.
export async function getRadio(songId: string, { waitMs = 0, saved = false } = {}): Promise<Radio> {
  const row = await db.songRadio.findUnique({ where: { songId } });
  if (row) {
    if (row.refreshAfter <= new Date()) void build(songId).stored.catch(() => {});
    return { ids: row.songIds };
  }
  const pending = build(songId);
  const result = saved ? pending.stored.then((ids) => ({ ids })) : pending.matched;
  void pending.stored.catch(() => {});
  if (!waitMs) return NONE;
  return Promise.race([result, new Promise<Radio>((r) => setTimeout(() => r(NONE), waitMs))]).catch(() => NONE);
}

// Cached radios only, for many seeds at once.
export async function cachedRadios(songIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db.songRadio.findMany({ where: { songId: { in: songIds } }, select: { songId: true, songIds: true } });
  return new Map(rows.map((r) => [r.songId, r.songIds]));
}

function build(songId: string): Build {
  let pending = building.get(songId);
  if (!pending) {
    let matched!: (r: Radio) => void;
    const build: Build = { matched: new Promise((r) => (matched = r)), stored: Promise.resolve([]) };
    build.stored = throttled(() => buildRadio(songId, matched)).finally(() => {
      matched(NONE); // if it failed before matching
      building.delete(songId);
    });
    building.set(songId, build);
    pending = build;
  }
  return pending;
}

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_BUILDS) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function buildRadio(songId: string, onMatched: (r: Radio) => void): Promise<string[]> {
  const song = await db.song.findUnique({
    where: { id: songId },
    include: { sources: true, artists: { orderBy: { position: "asc" }, include: { artist: { include: { sources: true } } } } },
  });
  if (!song) return [];
  const seed: DiscoverySeed = {
    title: song.title,
    artists: song.artists.map((a) => a.artist.name),
    sources: song.sources.map((s) => ({ provider: s.provider, externalId: s.externalId })),
    artistSources: song.artists[0]?.artist.sources.map((s) => ({ provider: s.provider, externalId: s.externalId })) ?? [],
  };

  const started = Date.now();
  const providers = getRegistry().withRole("discovery");
  const lists = await Promise.all(
    providers.map(async (p) => {
      try {
        const found = await withDeadline(p.discovery!.similarSongs(seed), PROVIDER_DEADLINE_MS, p.prefix);
        return p.discovery!.textOnly ? await lookUp(found.slice(0, TEXT_LOOKUPS)) : found.slice(0, PER_PROVIDER);
      } catch (err) {
        console.warn(`radio: ${p.prefix} failed for "${song.title}"`, err);
        return [];
      }
    }),
  );

  const resolved = await resolveCandidates(lists, { lane: "later" });
  // Each provider votes by rank; songs several of them suggest come first.
  const votes = new Map<string, number>();
  for (const list of lists) {
    list.forEach((c, rank) => {
      const id = resolved.get(c.source)?.id;
      if (id && id !== songId) votes.set(id, (votes.get(id) ?? 0) + 1 / (1 + rank / 8));
    });
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  onMatched({ ids: ranked, fresh: new Map([...resolved.values()].map((v) => [v.id, v])) });
  // Wait for new songs to be saved (and follow merges) before storing ids.
  const ids = [...new Set(await Promise.all(ranked.map((id) => persistQueue.settled(id, { background: true }))))].filter((id) => id !== songId);

  const refreshAfter = new Date(Date.now() + (ids.length ? REFRESH_MS : RETRY_EMPTY_MS));
  await db.songRadio.upsert({
    where: { songId },
    create: { songId, songIds: ids, refreshAfter },
    update: { songIds: ids, refreshAfter, fetchedAt: new Date() },
  });
  console.info(`radio: built "${song.title}" (${ids.length} songs from ${lists.map((l, i) => `${providers[i].prefix} ${l.length}`).join(", ")}) in ${Date.now() - started}ms`);
  return ids;
}

// Name-only suggestions, found on a search provider that has artwork and
// ISRCs (Deezer first). Ones that can't be found confidently are dropped.
export async function lookUp(refs: SongCandidate[]): Promise<SongCandidate[]> {
  const registry = getRegistry();
  const plugin: ProviderPlugin | undefined = registry.get("deezer") ?? registry.withRole("search").find((p) => !p.search!.attachOnly);
  const search = plugin?.search;
  if (!plugin || !search) return [];

  const lookUpOne = async (ref: SongCandidate): Promise<SongCandidate | undefined> => {
    const target = prepare({ title: ref.title, artists: ref.artists.map((a) => a.name) });
    try {
      const results = await withDeadline(search.searchSongs(`${ref.artists[0]?.name ?? ""} ${ref.title}`, 3), PROVIDER_DEADLINE_MS, plugin.prefix);
      return results.find((c) => compare(target, prepare({ title: c.title, artists: c.artists.map((a) => a.name) })).decision === "match");
    } catch {
      return undefined;
    }
  };

  // A few at a time, so background lookups never eat the search quota people are using.
  const found: (SongCandidate | undefined)[] = [];
  for (let i = 0; i < refs.length; i += LOOKUP_CONCURRENCY) {
    found.push(...(await Promise.all(refs.slice(i, i + LOOKUP_CONCURRENCY).map(lookUpOne))));
  }
  return found.filter((c): c is SongCandidate => !!c);
}
