import { randomUUID } from "node:crypto";
import { db } from "../db";
import { SONG_INCLUDE, songView, type SongResult, type SongWithRelations } from "../library/song-view";
import { compare, prepare } from "../matching/matcher";
import { displayTitle, normalizeText } from "../matching/normalize";
import { ProviderError, withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { ProviderPlugin, SongCandidate } from "../providers/types";
import { enqueuePersist, mergeSongs, songCredits, toHit, type Hit, type Member } from "./persist";
import { persistQueue } from "./persist-queue";

export type { SongResult, SourceResult } from "../library/song-view";

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

export interface SearchResponse {
  query: string;
  providers: ProviderStatus[];
  results: SongResult[];
  tookMs: number;
}

// Streamed in order: one "start", a "provider" per provider as it finishes
// (carrying the merged results so far), then "done".
export type SearchEvent =
  | { type: "start"; query: string; providers: { prefix: string; name: string }[] }
  | { type: "provider"; status: ProviderStatus; results: SongResult[] }
  | { type: "done"; tookMs: number };

// One canonical song: an existing Song and/or this search's hits.
interface Group {
  songId: string;
  canonical?: Hit; // set while the song is new and not yet queued for saving
  view: SongResult;
  reps: ReturnType<typeof prepare>[];
  members: Member[];
}

export async function searchSongs(query: string): Promise<SearchResponse> {
  const providers: ProviderStatus[] = [];
  let results: SongResult[] = [];
  let tookMs = 0;
  for await (const event of searchSongsStream(query)) {
    if (event.type === "provider") {
      providers.push(event.status);
      results = event.results;
    }
    if (event.type === "done") tookMs = event.tookMs;
  }
  return { query, providers, results, tookMs };
}

// Each provider's results are merged in as soon as it answers, so a slow
// provider only delays its own results.
export async function* searchSongsStream(query: string): AsyncGenerator<SearchEvent> {
  const started = Date.now();
  const providers = getRegistry().withRole("search");
  yield { type: "start", query, providers: providers.map((p) => ({ prefix: p.prefix, name: p.name })) };

  const pending = new Map(
    providers.map((p) => [p.prefix, runProvider(p, query).then((r) => ({ prefix: p.prefix, ...r }))]),
  );
  const session = new SearchSession();
  while (pending.size) {
    const { prefix, status, hits } = await Promise.race(pending.values());
    pending.delete(prefix);
    yield { type: "provider", status, results: await session.add(hits) };
  }
  yield { type: "done", tookMs: Date.now() - started };
}

async function runProvider(p: ProviderPlugin, query: string) {
  const t0 = Date.now();
  let songs: SongCandidate[] = [];
  let error: string | undefined;
  try {
    songs = await withDeadline(p.search!.searchSongs(query, PER_PROVIDER_LIMIT), PROVIDER_DEADLINE_MS, p.prefix);
  } catch (err) {
    console.warn(`search: ${p.prefix} failed`, err);
    error = err instanceof ProviderError ? err.message : String(err);
  }
  const status: ProviderStatus = { prefix: p.prefix, name: p.name, ok: !error, error, count: songs.length, ms: Date.now() - t0 };
  return { status, hits: songs.map(toHit) };
}

// Holds the groups for one search. Batches must be added one at a time.
class SearchSession {
  private readonly groups = new Map<string, Group>(); // by song id
  private readonly seen = new Set<string>();
  // Attach-only hits that haven't found a visible song yet; retried each batch
  // because the attach-only provider may answer before the others.
  private pending: { hit: Hit; known?: { songId: string; confidence: number; matchedBy: string } }[] = [];

  async add(batch: Hit[]): Promise<SongResult[]> {
    const hits = batch.filter((h) => !this.seen.has(h.candidate.source));
    hits.forEach((h) => this.seen.add(h.candidate.source));
    const joined = await this.group(hits);

    // Saving happens in the background; the results below come from memory.
    for (const [group, members] of joined) {
      enqueuePersist({ songId: group.songId, canonical: group.canonical, members });
      group.canonical = undefined; // queued: later jobs only add sources
    }

    return [...this.groups.values()]
      .sort((a, b) => groupScore(b) - groupScore(a))
      .map((g) => g.view);
  }

  // Places each hit in a group. Returns the new members per group, to save.
  private async group(hits: Hit[]): Promise<Map<Group, Member[]>> {
    const joined = new Map<Group, Member[]>();
    if (!hits.length) return joined;
    const registry = getRegistry();

    // Sources we've seen before skip matching entirely.
    const byProvider = new Map<string, string[]>();
    for (const h of hits) {
      byProvider.set(h.ref.provider, [...(byProvider.get(h.ref.provider) ?? []), h.ref.externalId]);
    }
    const known = await db.songSource.findMany({
      where: { OR: [...byProvider].map(([provider, ids]) => ({ provider, externalId: { in: ids } })) },
      select: { provider: true, externalId: true, songId: true, confidence: true, matchedBy: true },
    });
    const knownByUri = new Map(known.map((k) => [`${k.provider}:${k.externalId}`, k]));

    const isAttachOnly = (h: Hit) => registry.get(h.ref.provider)?.search?.attachOnly === true;
    const attachHits = hits.filter(isAttachOnly);
    hits = hits.filter((h) => !isAttachOnly(h));

    // Known hits' songs, plus existing songs new hits might belong to (by ISRC or core title).
    const unknown = hits.filter((h) => !knownByUri.has(h.candidate.source));
    const songs = await db.song.findMany({
      where: {
        id: { notIn: [...this.groups.keys()] },
        OR: [
          { id: { in: known.map((k) => k.songId) } },
          { isrc: { in: unknown.flatMap((h) => (h.prepared.isrc ? [h.prepared.isrc] : [])) } },
          { titleKey: { in: [...new Set(unknown.map((h) => h.prepared.core).filter(Boolean))] } },
        ],
      },
      include: SONG_INCLUDE,
    });

    // Songs from the database stay out of the results unless a hit joins them.
    const candidates = new Map(songs.map((s) => [s.id, groupFromSong(s)]));
    const place = (group: Group, member: Member) => {
      if (!this.groups.has(group.songId)) {
        this.groups.set(group.songId, group);
        candidates.delete(group.songId);
      }
      group.members.push(member);
      group.reps.push(member.hit.prepared);
    };

    for (const h of hits) {
      const k = knownByUri.get(h.candidate.source);
      const group = k && (this.groups.get(k.songId) ?? candidates.get(k.songId));
      if (group) place(group, { hit: h, confidence: k.confidence, matchedBy: k.matchedBy as Member["matchedBy"] });
    }

    // Known sources saved under different songs that match each other were
    // split before the matcher could tell them apart; fold them together.
    for (const h of hits) {
      const k = knownByUri.get(h.candidate.source);
      const home = k && k.matchedBy !== "manual" ? this.groups.get(k.songId) : undefined;
      if (!home) continue;
      const other = [...this.groups.values(), ...candidates.values()].find(
        (g) => g !== home && g.reps.some((rep) => compare(h.prepared, rep).decision === "match"),
      );
      if (!other) continue;
      // Keep the song with an ISRC: it came from a provider with better metadata.
      const [keep, drop] = !other.view.isrc && home.view.isrc ? [home, other] : [other, home];
      if (!this.groups.has(keep.songId)) {
        this.groups.set(keep.songId, keep);
        candidates.delete(keep.songId);
      }
      for (const m of drop.members) {
        keep.members.push(m);
        mergeIntoView(keep.view, m);
      }
      for (const s of drop.view.sources) {
        if (!keep.view.sources.some((x) => x.uri === s.uri)) keep.view.sources.push(s);
      }
      keep.reps.push(...drop.reps);
      this.groups.delete(drop.songId);
      candidates.delete(drop.songId);
      persistQueue.enqueue(keep.songId, () => mergeSongs(keep.songId, drop.songId));
    }

    // Best-ranked, most trusted hits first, so they become the anchors others join.
    const priority = (h: Hit) => registry.get(h.ref.provider)?.metadataPriority ?? 100;
    unknown.sort((a, b) => a.rank - b.rank || priority(a) - priority(b));

    for (const h of unknown) {
      const best = bestMatch(h, [...this.groups.values(), ...candidates.values()]);
      let member: Member;
      let group: Group;
      if (best) {
        group = best.group;
        member = { hit: h, confidence: best.score, matchedBy: best.reason === "isrc" ? "isrc" : "fuzzy" };
        // A more trusted provider's copy takes over the metadata of a song not yet saved.
        if (group.canonical && priority(h) < priority(group.canonical)) {
          group.canonical = h;
          group.view = { ...viewFromHit(group.songId, h), sources: group.view.sources };
          group.members.forEach((m) => mergeIntoView(group.view, m));
        }
      } else {
        const songId = randomUUID();
        group = { songId, canonical: h, view: viewFromHit(songId, h), reps: [], members: [] };
        member = { hit: h, confidence: 1, matchedBy: "origin" };
      }
      place(group, member);
      mergeIntoView(group.view, member);
      joined.set(group, [...(joined.get(group) ?? []), member]);
    }

    // Attach-only hits join songs already in the results, never new ones.
    this.pending.push(...attachHits.map((hit) => ({ hit, known: knownByUri.get(hit.candidate.source) })));
    this.pending = this.pending.filter(({ hit, known }) => {
      if (known) {
        const group = this.groups.get(known.songId);
        if (!group) return true;
        const member: Member = { hit, confidence: known.confidence, matchedBy: known.matchedBy as Member["matchedBy"] };
        place(group, member);
        mergeIntoView(group.view, member);
        return false;
      }
      const best = bestMatch(hit, [...this.groups.values()]);
      if (!best) return true;
      const member: Member = { hit, confidence: best.score, matchedBy: best.reason === "isrc" ? "isrc" : "fuzzy" };
      place(best.group, member);
      mergeIntoView(best.group.view, member);
      joined.set(best.group, [...(joined.get(best.group) ?? []), member]);
      return false;
    });
    return joined;
  }
}

function bestMatch(hit: Hit, groups: Group[]) {
  let best: { group: Group; score: number; reason: string } | undefined;
  for (const group of groups) {
    for (const rep of group.reps) {
      const r = compare(hit.prepared, rep);
      if (r.decision === "match" && (!best || r.score > best.score)) best = { group, score: r.score, reason: r.reason };
    }
  }
  return best;
}

function groupFromSong(song: SongWithRelations): Group {
  return {
    songId: song.id,
    reps: [
      prepare({
        title: song.title,
        artists: song.artists.map((a) => a.artist.name),
        durationMs: song.durationMs ?? undefined,
        isrc: song.isrc ?? undefined,
      }),
    ],
    members: [],
    view: songView(song),
  };
}

// Mirrors what persistGroup will write for a new song.
function viewFromHit(songId: string, hit: Hit): SongResult {
  const c = hit.candidate;
  return {
    id: songId,
    title: displayTitle(c.title),
    artists: songCredits(c).map(({ ref, role }) => ({ name: ref.name, role })),
    album: c.album ? { title: c.album.name } : undefined,
    durationMs: c.durationMs,
    isrc: hit.prepared.isrc,
    explicit: c.explicit ?? false,
    artworkUrl: c.artworkUrl,
    sources: [],
  };
}

// Adds a member's source and any credits the song is missing, as persistGroup does.
function mergeIntoView(view: SongResult, { hit, confidence, matchedBy }: Member) {
  if (!view.sources.some((s) => s.uri === hit.candidate.source)) {
    view.sources.push({
      uri: hit.candidate.source,
      provider: hit.ref.provider,
      playable: getRegistry().has(hit.ref.provider, "song"),
      confidence,
      matchedBy,
      rawTitle: hit.candidate.title,
    });
  }
  for (const { ref } of songCredits(hit.candidate)) {
    if (!view.artists.some((a) => normalizeText(a.name) === normalizeText(ref.name))) {
      view.artists.push({ name: ref.name, role: "featured" });
    }
  }
  view.isrc ??= hit.prepared.isrc;
  view.artworkUrl ??= hit.candidate.artworkUrl;
}

// Songs that several providers return, and rank highly, come first.
// Attach-only providers don't vote.
function groupScore(group: Group): number {
  const registry = getRegistry();
  return group.members
    .filter((m) => !registry.get(m.hit.ref.provider)?.search?.attachOnly)
    .reduce((sum, m) => sum + 1 / (1 + m.hit.rank), 0);
}
