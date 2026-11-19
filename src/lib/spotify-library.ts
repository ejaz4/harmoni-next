import { strFromU8, unzipSync } from "fflate";
import { LISTEN_ENDS, type ImportLibrary, type ImportListen, type ImportPlaylist, type ImportTrack, type ListenEnd } from "./import-library";

// Spotify's data download (spotify.com/account/privacy), boiled down to
// what Harmoni brings in. Read in the browser: the zips Spotify emails are
// opened here and only the summary is sent.
//
// "Account data" has YourLibrary.json (Liked Songs), Playlist1.json… and a
// year of plays (StreamingHistory_music_0.json…: when, what, how long).
// "Extended streaming history" has every play since the account began
// (Streaming_History_Audio_*.json), with how each one ended. Files are
// recognised by what's in them, not their names, which Spotify changes;
// either download, or both together, will do.

type Json = Record<string, unknown>;
type Entry = { name: string; text: string };

const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const trackIdOf = (uri: unknown) => (typeof uri === "string" ? uri.match(/^spotify:track:([A-Za-z0-9]{10,40})$/)?.[1] : undefined);

// Spotify lists Liked Songs without dates. Taken as newest first, the way
// the app shows them, and dated a second apart so they keep that order here.
const LIKED_NEWEST_FIRST = true;

// How a play ended (`reason_end`), in Harmoni's terms. Picking another song
// counts as skipping this one; the app closing or another device taking
// over doesn't say anything about the song.
const ENDS: Record<string, ListenEnd> = {
  trackdone: "ended",
  fwdbtn: "skip",
  clickrow: "skip",
  playbtn: "skip",
  uriopen: "skip",
  backbtn: "back",
  endplay: "close",
  logout: "close",
  remote: "close",
  "unexpected-exit": "close",
  "unexpected-exit-while-paused": "close",
  trackerror: "close",
  appload: "close",
  popup: "close",
};

class Library {
  readonly tracks: ImportTrack[] = [];
  private readonly byId = new Map<string, number>();
  private readonly byName = new Map<string, number>();

  // The track's place in `tracks`, adding it the first time it's seen. The
  // year of plays in "Account data" has no Spotify ids, so those are found by
  // artist and title.
  track(t: { uri?: unknown; title: string; artist: string; album?: string; durationMs?: number }): number {
    const id = trackIdOf(t.uri);
    const nameKey = `${t.artist.toLowerCase()}\u0000${t.title.toLowerCase()}`;
    const known = id ? this.byId.get(id) : this.byName.get(nameKey);
    if (known !== undefined) {
      const k = this.tracks[known];
      k.album ??= t.album;
      k.durationMs ??= t.durationMs;
      return known;
    }
    const i = this.tracks.length;
    this.tracks.push({
      id: id ?? `n${i}`, // Spotify's ids are 22 characters, so these can't clash
      title: t.title,
      artist: t.artist,
      album: t.album,
      durationMs: t.durationMs,
      explicit: false,
      inLibrary: false,
      loved: false,
      plays: 0,
      skips: 0,
    });
    if (id) this.byId.set(id, i);
    if (!this.byName.has(nameKey)) this.byName.set(nameKey, i);
    return i;
  }
}

// "spotify:local:Artist:Album:Title:213": a file on their computer, added to a playlist.
function localTrack(uri: unknown) {
  if (typeof uri !== "string" || !uri.startsWith("spotify:local:")) return;
  const [artist, album, title, seconds] = uri
    .slice("spotify:local:".length)
    .split(":")
    .map((p) => {
      try {
        return decodeURIComponent(p.replace(/\+/g, " ")).trim();
      } catch {
        return p;
      }
    });
  if (!title) return;
  return { title: title.slice(0, 300), artist: (artist ?? "").slice(0, 300), album: album || undefined, durationMs: Number(seconds) > 0 ? Number(seconds) * 1000 : undefined };
}

type Kind = "library" | "playlists" | "history" | "year";

function kindOf(data: unknown): Kind | undefined {
  if (Array.isArray(data)) {
    const first = data.find(isObj);
    if (!first) return;
    if ("ts" in first && "ms_played" in first) return "history";
    if ("endTime" in first && "msPlayed" in first && "trackName" in first) return "year";
    return;
  }
  if (!isObj(data)) return;
  if (Array.isArray(data.playlists)) return "playlists";
  if (Array.isArray(data.tracks) && data.tracks.some((t) => isObj(t) && "track" in t && "artist" in t)) return "library";
}

// The JSON files in Spotify's downloads (zips, zips in zips, or the JSON files themselves).
export async function readSpotifyFiles(files: File[]): Promise<ImportLibrary> {
  const entries: Entry[] = [];
  const open = (name: string, bytes: Uint8Array, depth: number) => {
    if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      if (depth > 1) return;
      let unzipped: Record<string, Uint8Array>;
      try {
        // Only what might be music: no podcasts, video or the rest of the account's data.
        unzipped = unzipSync(bytes, { filter: (f) => /\.(json|zip)$/i.test(f.name) && !/podcast|video|audiobook|__MACOSX/i.test(f.name) });
      } catch {
        throw new Error(`Couldn't open ${name}. Is it the zip Spotify sent?`);
      }
      for (const [inner, data] of Object.entries(unzipped)) open(inner, data, depth + 1);
    } else if (/\.json$/i.test(name)) entries.push({ name, text: strFromU8(bytes) });
  };
  for (const f of files) open(f.name, new Uint8Array(await f.arrayBuffer()), 0);
  return readSpotifyExport(entries);
}

export function readSpotifyExport(entries: Entry[], now = Date.now()): ImportLibrary {
  const lib = new Library();
  const playlists: ImportPlaylist[] = [];
  const listens: ImportListen[] = [];
  const byKind: Record<Kind, unknown[]> = { library: [], playlists: [], history: [], year: [] };
  for (const e of entries) {
    let data: unknown;
    try {
      data = JSON.parse(e.text);
    } catch {
      continue;
    }
    const kind = kindOf(data);
    if (kind) byKind[kind].push(data);
  }
  if (!Object.values(byKind).some((k) => k.length))
    throw new Error("That doesn't look like your Spotify data. Pick the zip Spotify emailed you (my_spotify_data.zip).");

  // Liked Songs.
  for (const file of byKind.library as Json[]) {
    const tracks = (file.tracks as unknown[]).filter(isObj);
    tracks.forEach((t, n) => {
      const title = str(t.track);
      if (!title) return;
      const track = lib.tracks[lib.track({ uri: t.uri, title, artist: str(t.artist) ?? "", album: str(t.album) })];
      track.inLibrary = true;
      track.loved = true;
      const order = LIKED_NEWEST_FIRST ? n : tracks.length - n;
      track.addedAt ??= new Date(now - order * 1000).toISOString();
    });
  }

  // Playlists. The download has no ids for them, so their names stand in.
  const names = new Map<string, number>();
  for (const file of byKind.playlists as Json[]) {
    for (const p of (file.playlists as unknown[]).filter(isObj)) {
      const name = str(p.name, 100);
      if (!name) continue;
      const seen = (names.get(name) ?? 0) + 1;
      names.set(name, seen);
      const trackIds: string[] = [];
      for (const item of Array.isArray(p.items) ? p.items.filter(isObj) : []) {
        const t = isObj(item.track) ? item.track : undefined;
        const title = str(t?.trackName);
        const info = t && title ? { uri: t.trackUri, title, artist: str(t.artistName) ?? "", album: str(t.albumName) } : localTrack(isObj(item.localTrack) ? item.localTrack.uri : undefined);
        if (info) trackIds.push(lib.tracks[lib.track(info)].id);
      }
      playlists.push({ id: seen > 1 ? `${name}#${seen}` : name, name, description: str(p.description), trackIds });
    }
  }

  // Every play, with how it ended. Private sessions stay private.
  let historyUntil = 0;
  for (const file of byKind.history as unknown[][]) {
    for (const p of file.filter(isObj)) {
      const title = str(p.master_metadata_track_name);
      const at = typeof p.ts === "string" ? Date.parse(p.ts) : NaN;
      const ms = num(p.ms_played);
      if (!title || Number.isNaN(at) || ms === undefined || p.incognito_mode === true) continue;
      const i = lib.track({ uri: p.spotify_track_uri, title, artist: str(p.master_metadata_album_artist_name) ?? "", album: str(p.master_metadata_album_album_name) });
      const end: ListenEnd = p.skipped === true ? "skip" : (ENDS[String(p.reason_end)] ?? "unknown");
      listens.push([i, Math.round(at / 1000), ms, LISTEN_ENDS.indexOf(end)]);
      historyUntil = Math.max(historyUntil, at);
    }
  }

  // The year of plays in "Account data": only what's newer than the full
  // history, when both are here. It doesn't say how plays ended.
  for (const file of byKind.year as unknown[][]) {
    for (const p of file.filter(isObj)) {
      const title = str(p.trackName);
      const at = typeof p.endTime === "string" ? Date.parse(`${p.endTime.replace(" ", "T")}${p.endTime.length <= 16 ? ":00" : ""}Z`) : NaN;
      const ms = num(p.msPlayed);
      if (!title || Number.isNaN(at) || ms === undefined || at <= historyUntil) continue;
      listens.push([lib.track({ title, artist: str(p.artistName) ?? "" }), Math.round(at / 1000), ms, 0]);
    }
  }

  // Counts per song, for the summary and for which songs are looked up first.
  listens.sort((a, b) => a[1] - b[1]);
  for (const [i, at, ms, end] of listens) {
    const t = lib.tracks[i];
    const skipped = LISTEN_ENDS[end] === "skip" || LISTEN_ENDS[end] === "back";
    if (skipped && ms < 30_000) t.skips++;
    else t.plays++;
    const when = new Date(at * 1000).toISOString();
    if (skipped) t.skippedAt = when;
    else t.playedAt = when;
  }

  return { source: "spotify", tracks: lib.tracks, playlists, listens: listens.length ? listens : undefined };
}
