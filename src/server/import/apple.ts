import { Prisma } from "@/generated/prisma/client";
import { IMPORT_LIMITS, type AppleLibrary, type ApplePlaylist, type AppleTrack, type ImportProgress, type ImportStatus, type ImportSummary } from "@/lib/apple-library";
import { db } from "../db";
import { rebuildHome } from "../discovery/home";
import { SLICES } from "../discovery/score";
import { forgetTaste } from "../discovery/taste";
import { compare, prepare } from "../matching/matcher";
import { splitArtistNames } from "../matching/normalize";
import { withDeadline } from "../providers/errors";
import { getRegistry } from "../providers/registry";
import type { SongCandidate } from "../providers/types";
import { isBenched } from "../playback/health";
import { createBareSong, mergeSongs } from "../search/persist";
import { persistQueue } from "../search/persist-queue";
import { resolveCandidates } from "../search/service";

// Bringing in an Apple Music library, on top of what they already have
// (nothing of theirs is removed): their library as likes, their playlists,
// and their play counts as listening.
//
// Adding: every song goes in straight away, as the song already in Harmoni
// or made from the file's details, so the whole library is there in a
// few minutes. Improving: the songs made from details are then looked up on
// the providers, slowly, in the background, for artwork and their details,
// as if they'd been found by searching. Playing one finds a copy to play
// from either way.
//
// Progress is kept in the database: any instance can report it, and pick it
// up if the one running it stops.

const WORKERS = 4;
const SAVE_EVERY = 50;
const STALE_MS = 90_000; // no word from the instance running it: someone else takes over
const SEARCH_DEADLINE_MS = 8000;
// Where to look, in order, and how often an import may ask each.
const PROVIDERS: { prefix: string; gapMs: number }[] = [
  { prefix: "deezer", gapMs: 220 },
  { prefix: "tidal", gapMs: 500 },
  { prefix: "ytm", gapMs: 400 },
  { prefix: "itunes", gapMs: 3100 }, // Apple's own catalogue, but only ~20 searches a minute
];
// Plenty, since providers list remixes and live versions ahead of the original.
const RESULTS = 25;
// Not quite a match (credits written differently, say), but the same title
// and a length this close: it's the song.
const CLOSE_ENOUGH_MS = 2000;

type Row = Awaited<ReturnType<typeof db.libraryImport.findUniqueOrThrow>>;
type Matches = Record<string, string>;
const RUNNING = ["adding", "improving"];

// --- Starting, watching, stopping ---

export class ImportError extends Error {}

export function checkLibrary(raw: unknown): AppleLibrary {
  const lib = raw as Partial<AppleLibrary> | undefined;
  if (!lib || !Array.isArray(lib.tracks) || !Array.isArray(lib.playlists)) throw new ImportError("That isn't a library.");
  if (!lib.tracks.length) throw new ImportError("There are no songs in that library.");
  if (lib.tracks.length > IMPORT_LIMITS.tracks || lib.playlists.length > IMPORT_LIMITS.playlists) throw new ImportError("That library is too big to bring in.");
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1e6) : 0);
  const when = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
  const tracks: AppleTrack[] = lib.tracks.flatMap((t) => {
    const id = text(t?.id, 20);
    const title = text(t?.title, 300)?.trim();
    if (!id || !title) return [];
    return [
      {
        id,
        title,
        artist: text(t.artist, 300) ?? "",
        album: text(t.album, 300),
        durationMs: count(t.durationMs) || undefined,
        explicit: t.explicit === true,
        inLibrary: t.inLibrary !== false,
        loved: t.loved === true,
        addedAt: when(t.addedAt),
        plays: count(t.plays),
        playedAt: when(t.playedAt),
        skips: count(t.skips),
        skippedAt: when(t.skippedAt),
      },
    ];
  });
  const ids = new Set(tracks.map((t) => t.id));
  const playlists: ApplePlaylist[] = lib.playlists.flatMap((p) => {
    const id = text(p?.id, 40);
    const name = text(p?.name, 100)?.trim();
    if (!id || !name || !Array.isArray(p.trackIds)) return [];
    const trackIds = p.trackIds.filter((t): t is string => typeof t === "string" && ids.has(t)).slice(0, IMPORT_LIMITS.playlistTracks);
    return [{ id, name, description: text(p.description, 300), trackIds }];
  });
  return { tracks, playlists };
}

export async function startImport(userId: string, library: AppleLibrary): Promise<ImportProgress> {
  const running = await db.libraryImport.findFirst({ where: { userId, status: "adding" } });
  if (running) throw new ImportError("A library is already being brought in.");
  // Still improving the last one: this one carries on from where that got to.
  await db.libraryImport.updateMany({ where: { userId, status: "improving" }, data: { status: "done", finishedAt: new Date() } });
  const row = await db.libraryImport.create({
    data: { userId, status: "adding", library: library as unknown as Prisma.InputJsonValue, total: library.tracks.length },
  });
  void run(row.id, true);
  return progress(row);
}

// Their latest import. One that's stopped hearing from whoever was running it is picked up here.
export async function latestImport(userId: string): Promise<ImportProgress | null> {
  const row = await db.libraryImport.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  if (RUNNING.includes(row.status) && Date.now() - row.heartbeatAt.getTime() > STALE_MS) void run(row.id);
  return progress(row);
}

// Every instance looks for imports nobody is running (one was stopped by a
// deploy, say) and carries them on; `claim` makes sure only one does.
export async function resumeStaleImports(): Promise<void> {
  const stale = await db.libraryImport.findMany({
    where: { status: { in: RUNNING }, heartbeatAt: { lt: new Date(Date.now() - STALE_MS) } },
    select: { id: true },
  });
  for (const { id } of stale) void run(id);
}

// Stops it. While adding, nothing is added; while improving, what's done is kept.
export async function cancelImport(userId: string): Promise<void> {
  await db.libraryImport.updateMany({ where: { userId, status: "adding" }, data: { status: "cancelled", finishedAt: new Date() } });
  await db.libraryImport.updateMany({ where: { userId, status: "improving" }, data: { status: "done", finishedAt: new Date() } });
}

function progress(row: Row): ImportProgress {
  return {
    id: row.id,
    status: row.status as ImportStatus,
    total: row.total,
    done: row.done,
    known: row.known,
    toImprove: row.bare.length,
    improved: row.improved,
    found: row.found,
    summary: (row.summary as ImportSummary | null) ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
  };
}

// --- Running it ---

// Takes the import on, unless another instance has it.
async function claim(id: string): Promise<boolean> {
  const { count } = await db.libraryImport.updateMany({
    where: { id, status: { in: RUNNING }, heartbeatAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { heartbeatAt: new Date() },
  });
  return count > 0;
}

// `ours`: just created here, so nobody else could have it.
async function run(id: string, ours = false): Promise<void> {
  if (!ours && !(await claim(id))) return;
  // Still here: keeps others from taking over, however slow a song is to find.
  const beat = setInterval(() => {
    void db.libraryImport.updateMany({ where: { id, status: { in: RUNNING } }, data: { heartbeatAt: new Date() } }).catch(() => {});
  }, STALE_MS / 4);
  try {
    let row = await db.libraryImport.findUniqueOrThrow({ where: { id } });
    if (row.status === "adding") {
      if (!(await add(row))) return;
      row = await db.libraryImport.findUniqueOrThrow({ where: { id } });
      forgetTaste(row.userId);
      void rebuildHome(row.userId).catch(() => {});
    }
    if (row.status === "improving") await improve(row);
  } catch (err) {
    console.error(`import: ${id} failed`, err);
    await db.libraryImport
      .updateMany({ where: { id, status: "adding" }, data: { status: "failed", error: "Something went wrong bringing it in.", finishedAt: new Date() } })
      .catch(() => {});
    // Improving is extra: what's been added stays, and it can carry on later.
  } finally {
    clearInterval(beat);
  }
}

// Every song in, then into their library. False if it was stopped.
async function add(row: Row): Promise<boolean> {
  const { id } = row;
  const library = row.library as unknown as AppleLibrary;
  const matches: Matches = { ...(row.matches as Matches) };
  const bare = new Set(row.bare);
  let known = row.known;
  const started = Date.now();

  // The same song in the file twice goes in once.
  const byKey = new Map<string, AppleTrack[]>();
  for (const t of library.tracks) {
    if (t.id in matches) continue;
    const key = `${t.title}\u0000${t.artist}\u0000${Math.round((t.durationMs ?? 0) / 1000)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  const todo = [...byKey.values()];
  let unsaved = 0;
  let stopped = false;
  const save = async () => {
    unsaved = 0;
    const { count } = await db.libraryImport.updateMany({
      where: { id, status: "adding" },
      data: { matches, done: Object.keys(matches).length, known, bare: [...bare] },
    });
    if (!count) stopped = true; // cancelled
  };
  const worker = async () => {
    while (todo.length && !stopped) {
      const group = todo.shift()!;
      const t = group[0];
      let songId = await knownSong(t);
      if (songId) known += group.length;
      else {
        songId = await createBareSong({
          source: `apple:${t.id}`,
          title: t.title,
          artists: splitArtistNames([t.artist]).map((name) => ({ name })),
          album: t.album ? { name: t.album.replace(/\s+-\s+(EP|Single)$/i, "") } : undefined,
          durationMs: t.durationMs,
          explicit: t.explicit,
        });
        bare.add(songId);
      }
      for (const g of group) matches[g.id] = songId;
      if (++unsaved >= SAVE_EVERY) await save();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  if (stopped) return false;
  // Improved first: their library, newest first, then playlist songs.
  const rank = new Map<string, number>();
  for (const t of library.tracks) {
    const r = t.inLibrary ? -(t.addedAt ? Date.parse(t.addedAt) : 0) : 0;
    const songId = matches[t.id];
    rank.set(songId, Math.min(rank.get(songId) ?? 0, r));
  }
  const order = [...bare].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  bare.clear();
  order.forEach((s) => bare.add(s));
  await save();
  if (stopped) return false;

  const summary = await apply(row.userId, id, library, matches);
  const { count } = await db.libraryImport.updateMany({
    where: { id, status: "adding" },
    data: { status: "improving", summary: summary as unknown as Prisma.InputJsonValue },
  });
  console.info(`import: added ${library.tracks.length} songs for ${row.userId} (${known} already known, ${bare.size} new) in ${Math.round((Date.now() - started) / 1000)}s`);
  return count > 0;
}

// The songs made from the file's details, looked up one by one.
async function improve(row: Row): Promise<void> {
  const { id } = row;
  const list = row.bare;
  let next = row.improved;
  let found = row.found;
  const finished = new Set<number>();
  let stopped = false;
  let unsaved = 0;
  // Everything before the first unfinished one is done, so that's where to pick up from.
  const doneUpTo = () => {
    let i = row.improved;
    while (finished.has(i)) i++;
    return i;
  };
  const save = async () => {
    unsaved = 0;
    const { count } = await db.libraryImport.updateMany({ where: { id, status: "improving" }, data: { improved: doneUpTo(), found } });
    if (!count) stopped = true; // stopped, or a new import took over
  };
  const worker = async () => {
    while (next < list.length && !stopped) {
      const i = next++;
      if (await improveSong(list[i]).catch(() => false)) found++;
      finished.add(i);
      if (++unsaved >= 25) await save();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  if (stopped) return;
  await save();
  if (stopped) return;

  // What no provider had. (The rest get a copy to play from the first time
  // they're played, like any song found by searching.)
  const ids = [...new Set(await Promise.all(list.map((s) => persistQueue.settled(s))))];
  const unplayable = await db.song.findMany({
    where: { id: { in: ids }, sources: { none: {} } },
    select: { title: true, artists: { orderBy: { position: "asc" }, select: { artist: { select: { name: true } } } } },
  });
  const missing = unplayable
    .map((s) => ({ title: s.title, artist: s.artists.map((a) => a.artist.name).join(", ") }))
    .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  const summary = { ...(row.summary as unknown as ImportSummary), missing };
  await db.libraryImport.updateMany({
    where: { id, status: "improving" },
    data: { status: "done", summary: summary as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
  });
  console.info(`import: improved ${list.length} songs for ${row.userId}, found ${found}; ${missing.length} weren't found anywhere`);
}

// --- Finding songs ---

type Prepared = ReturnType<typeof prepare>;
type Info = { title: string; artists: string[]; durationMs?: number };

function best<T>(target: Prepared, items: T[], info: (item: T) => Info): T | undefined {
  let top: { item: T; score: number } | undefined;
  for (const item of items) {
    const i = info(item);
    const p = prepare(i);
    const r = compare(target, p);
    if (r.decision === "different") continue;
    const sameTitle = target.titles.some((t) => p.titles.includes(t));
    const sameLength = target.durationMs !== undefined && i.durationMs !== undefined && Math.abs(target.durationMs - i.durationMs) <= CLOSE_ENOUGH_MS;
    if ((r.decision === "match" || (sameTitle && sameLength)) && (!top || r.score > top.score)) top = { item, score: r.score };
  }
  return top?.item;
}

// The song already in Harmoni, if it is.
async function knownSong(track: AppleTrack): Promise<string | undefined> {
  const target = prepare({ title: track.title, artists: splitArtistNames([track.artist]), durationMs: track.durationMs });
  const songs = await db.song.findMany({
    where: { titleKey: target.core },
    take: 25,
    select: { id: true, title: true, durationMs: true, artists: { orderBy: { position: "asc" }, select: { artist: { select: { name: true } } } } },
  });
  return best(target, songs, (s) => ({ title: s.title, artists: s.artists.map((a) => a.artist.name), durationMs: s.durationMs ?? undefined }))?.id;
}

const lastAsked = new Map<string, Promise<void>>();
// Waits for this provider's turn: at most one request per `gapMs` from imports.
function turn(prefix: string, gapMs: number): Promise<void> {
  const prev = lastAsked.get(prefix) ?? Promise.resolve();
  lastAsked.set(
    prefix,
    prev.then(() => new Promise<void>((r) => setTimeout(r, gapMs))),
  );
  return prev;
}

// Looks a song made from details up on the providers. When found, the
// provider's copy joins it (artwork, somewhere to play) or, if Harmoni
// already had that recording, it joins that, likes and playlists and all.
export async function improveSong(id: string): Promise<boolean> {
  const songId = await persistQueue.settled(id);
  const song = await db.song.findUnique({
    where: { id: songId },
    select: { title: true, durationMs: true, artworkUrl: true, sources: { select: { provider: true } }, artists: { orderBy: { position: "asc" }, select: { artist: { select: { name: true } } } } },
  });
  if (!song) return false;
  if (song.artworkUrl && song.sources.length) return true; // played since, and found then
  const artists = song.artists.map((a) => a.artist.name);
  const target = prepare({ title: song.title, artists, durationMs: song.durationMs ?? undefined });
  const query = `${artists[0] ?? ""} ${song.title}`.trim();
  const registry = getRegistry();
  for (const { prefix, gapMs } of PROVIDERS) {
    const search = registry.get(prefix)?.search;
    if (!search || search.attachOnly || isBenched(prefix)) continue;
    await turn(prefix, gapMs);
    const results = await withDeadline(search.searchSongs(query, RESULTS), SEARCH_DEADLINE_MS, prefix).catch((): SongCandidate[] => []);
    const hit = best(target, results, (c) => ({ title: c.title, artists: c.artists.map((a) => a.name), durationMs: c.durationMs }));
    if (!hit) continue;
    const view = (await resolveCandidates([[hit]], { lane: "later" })).get(hit.source);
    if (!view) continue;
    const foundId = await persistQueue.settled(view.id, { background: true });
    if (foundId !== songId) await mergeSongs(foundId, songId);
    return true;
  }
  return false;
}

// --- Adding it to their library ---

async function apply(userId: string, importId: string, library: AppleLibrary, matches: Matches): Promise<ImportSummary> {
  const now = Date.now();
  // Songs merged since they were matched: follow them to the song that's left.
  const ids = [...new Set(Object.values(matches))];
  const settled = new Map(await Promise.all(ids.map(async (s) => [s, await persistQueue.settled(s)] as const)));
  const existing = new Set((await db.song.findMany({ where: { id: { in: [...settled.values()] } }, select: { id: true } })).map((s) => s.id));
  const songOf = (trackId: string) => {
    const s = settled.get(matches[trackId]);
    return s && existing.has(s) ? s : undefined;
  };

  // Their library: liked, as of when they added each song. Ones they've already liked keep their date.
  const likes = new Map<string, Date>();
  for (const t of library.tracks) {
    const songId = t.inLibrary ? songOf(t.id) : undefined;
    if (!songId) continue;
    const at = t.addedAt ? new Date(t.addedAt) : new Date(now);
    const had = likes.get(songId);
    if (!had || at < had) likes.set(songId, at);
  }
  const { count: liked } = await db.like.createMany({
    data: [...likes].map(([songId, createdAt]) => ({ userId, songId, createdAt })),
    skipDuplicates: true,
  });

  // Playlists: the same names, descriptions and order. Bringing the same one
  // in again updates it, keeping anything they've added on Harmoni since.
  const previous = await db.libraryImport.findFirst({
    where: { userId, status: { in: ["done", "improving"] }, id: { not: importId } },
    orderBy: { createdAt: "desc" },
    select: { summary: true, applied: true },
  });
  const lastAppliedAt = (previous?.summary as ImportSummary | null)?.appliedAt;
  const playlists: ImportSummary["playlists"] = [];
  // Apple lists them A–Z; made in reverse so the first is the newest.
  for (const p of [...library.playlists].reverse()) {
    const songIds = p.trackIds.flatMap((t) => songOf(t) ?? []);
    const items = songIds.map((songId, position) => ({ songId, position, addedAt: new Date(now + position) }));
    const key = `apple:${p.id}`;
    await db.$transaction(
      async (tx) => {
        const playlist = await tx.playlist.upsert({
          where: { ownerId_importKey: { ownerId: userId, importKey: key } },
          create: { ownerId: userId, importKey: key, name: p.name, description: p.description },
          update: { name: p.name, description: p.description ?? null },
        });
        // What the last import brought in goes; what they added since stays, after Apple's songs.
        if (lastAppliedAt) {
          const from = new Date(lastAppliedAt);
          await tx.playlistItem.deleteMany({
            where: { playlistId: playlist.id, addedAt: { gte: from, lte: new Date(from.getTime() + IMPORT_LIMITS.playlistTracks) } },
          });
        }
        const kept = await tx.playlistItem.findMany({ where: { playlistId: playlist.id }, orderBy: { position: "asc" }, select: { id: true } });
        await tx.playlistItem.createMany({ data: items.map((i) => ({ ...i, playlistId: playlist.id })) });
        for (const [i, item] of kept.entries()) await tx.playlistItem.update({ where: { id: item.id }, data: { position: items.length + i } });
      },
      { timeout: 60_000 },
    );
    playlists.unshift({ name: p.name, songs: songIds.length });
  }

  // Listening: Apple's plays and skips count as listens, added to Harmoni's
  // own. Bringing the same library in again only adds what's new since.
  const before = (previous?.applied as Record<string, [number, number]> | null) ?? {};
  const totals = new Map<string, { plays: number; skips: number; durationMs?: number; firstAt?: Date; lastAt?: Date; playedAt?: Date }>();
  for (const t of library.tracks) {
    const songId = songOf(t.id);
    if (!songId || (!t.plays && !t.skips)) continue;
    const s = totals.get(songId) ?? { plays: 0, skips: 0 };
    s.plays += t.plays;
    s.skips += t.skips;
    s.durationMs ??= t.durationMs;
    const last = [t.playedAt, t.skippedAt].flatMap((d) => (d ? [new Date(d)] : [])).sort((a, b) => b.getTime() - a.getTime())[0];
    if (last && (!s.lastAt || last > s.lastAt)) s.lastAt = last;
    if (t.playedAt && (!s.playedAt || new Date(t.playedAt) > s.playedAt)) s.playedAt = new Date(t.playedAt);
    const first = t.addedAt ? new Date(t.addedAt) : last;
    if (first && (!s.firstAt || first < s.firstAt)) s.firstAt = first;
    totals.set(songId, s);
  }
  const applied: Record<string, [number, number]> = {};
  const rows: Prisma.Sql[] = [];
  for (const [songId, s] of totals) {
    applied[songId] = [s.plays, s.skips];
    const plays = Math.max(0, s.plays - (before[songId]?.[0] ?? 0));
    const skips = Math.max(0, s.skips - (before[songId]?.[1] ?? 0));
    if (!plays && !skips) continue;
    const lastAt = s.lastAt ?? new Date(now);
    const firstAt = s.firstAt && s.firstAt < lastAt ? s.firstAt : lastAt;
    rows.push(
      Prisma.sql`(${userId}, ${songId}, ${plays + skips}, ${plays}, ${skips}, ${skips}, 0, ${BigInt(plays * (s.durationMs ?? 0))}, array_fill(0, ARRAY[${SLICES}::int]), ${firstAt}, ${lastAt})`,
    );
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.$executeRaw`
      INSERT INTO "SongStat" ("userId", "songId", "listens", "completes", "skips", "earlySkips", "replays", "playedMs", "heard", "firstAt", "lastAt")
      VALUES ${Prisma.join(rows.slice(i, i + 500))}
      ON CONFLICT ("userId", "songId") DO UPDATE SET
        "listens" = "SongStat"."listens" + EXCLUDED."listens",
        "completes" = "SongStat"."completes" + EXCLUDED."completes",
        "skips" = "SongStat"."skips" + EXCLUDED."skips",
        "earlySkips" = "SongStat"."earlySkips" + EXCLUDED."earlySkips",
        "playedMs" = "SongStat"."playedMs" + EXCLUDED."playedMs",
        "firstAt" = LEAST("SongStat"."firstAt", EXCLUDED."firstAt"),
        "lastAt" = GREATEST("SongStat"."lastAt", EXCLUDED."lastAt")`;
  }

  // Recently played: each song once, when Apple last played it.
  const lastPlays = [...totals].flatMap(([songId, s]) => (s.playedAt ? [{ userId, songId, playedAt: s.playedAt }] : []));
  const already = new Set(
    (await db.play.findMany({ where: { userId, playedAt: { in: lastPlays.map((p) => p.playedAt) } }, select: { songId: true, playedAt: true } })).map(
      (p) => `${p.songId}@${p.playedAt.getTime()}`,
    ),
  );
  await db.play.createMany({ data: lastPlays.filter((p) => !already.has(`${p.songId}@${p.playedAt.getTime()}`)) });
  await db.libraryImport.update({ where: { id: importId }, data: { applied } });

  return { liked, playlists, listening: rows.length, appliedAt: new Date(now).toISOString() };
}
