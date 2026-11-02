// Apple Music's Library.xml (Music or iTunes on a computer: File → Library →
// Export Library…), boiled down to what Harmoni brings in. Read in the
// browser, so only this small summary is sent, not the whole file.

export interface AppleTrack {
  id: string; // Apple's track id, within this file
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  explicit: boolean;
  inLibrary: boolean; // false: only in a playlist
  loved: boolean;
  addedAt?: string;
  plays: number;
  playedAt?: string;
  skips: number;
  skippedAt?: string;
}

export interface ApplePlaylist {
  id: string; // persistent id, the same in every export
  name: string;
  description?: string;
  trackIds: string[]; // in order
}

export interface AppleLibrary {
  tracks: AppleTrack[];
  playlists: ApplePlaylist[];
}

// How bringing one in is going (GET /api/import).
export type ImportStatus = "adding" | "improving" | "done" | "failed" | "cancelled";

export interface ImportSummary {
  liked: number; // songs added to their likes
  playlists: { name: string; songs: number }[];
  listening: number; // songs whose plays and skips were counted
  appliedAt: string; // its playlist songs are dated from here, a millisecond apart
  missing?: { title: string; artist: string }[]; // once improved: no provider had these
}

export interface ImportProgress {
  id: string;
  status: ImportStatus;
  total: number;
  done: number;
  known: number;
  toImprove: number;
  improved: number;
  found: number;
  summary?: ImportSummary;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export const IMPORT_LIMITS = { tracks: 60_000, playlists: 2000, playlistTracks: 20_000 };

type Value = string | number | boolean | Value[] | { [key: string]: Value };
type Dict = { [key: string]: Value };

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.includes("&")
    ? s.replace(ENTITY, (_, e: string) =>
        e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : NAMED[e.toLowerCase()],
      )
    : s;

// A property list, which is all Library.xml is. Values never contain "<"
// (XML escapes it), so one pass of a regex finds every element.
export function parsePlist(xml: string): Value {
  const token =
    /<(key|string|integer|real|date|data)>([^<]*)<\/\1>|<(key|string|integer|real|date|data)\/>|<(true|false)\/>|<(dict|array)>|<\/(dict|array)>|<(dict|array)\/>/g;
  const stack: (Dict | Value[])[] = [];
  let key: string | undefined;
  let root: Value | undefined;
  const add = (v: Value) => {
    const top = stack[stack.length - 1];
    if (!top) root ??= v;
    else if (Array.isArray(top)) top.push(v);
    else if (key !== undefined) {
      top[key] = v;
      key = undefined;
    }
  };
  for (const m of xml.matchAll(token)) {
    const [, tag, text, emptyTag, bool, open, , emptyContainer] = m;
    const scalar = tag ?? emptyTag;
    if (scalar) {
      const s = decode(text ?? "");
      if (scalar === "key") key = s;
      else if (scalar === "integer" || scalar === "real") add(Number(s));
      else add(s);
    } else if (bool) add(bool === "true");
    else if (open || emptyContainer) {
      const v: Dict | Value[] = (open ?? emptyContainer) === "dict" ? {} : [];
      add(v);
      if (open) stack.push(v);
    } else stack.pop();
  }
  return root ?? {};
}

const str = (v: Value | undefined) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined);
const num = (v: Value | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
const date = (v: Value | undefined) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);
const isDict = (v: Value | undefined): v is Dict => !!v && typeof v === "object" && !Array.isArray(v);

export function readAppleLibrary(xml: string): AppleLibrary {
  const root = parsePlist(xml);
  if (!isDict(root) || !isDict(root.Tracks)) throw new Error("That doesn't look like a Library.xml from Apple Music or iTunes.");

  const tracks: AppleTrack[] = [];
  for (const t of Object.values(root.Tracks)) {
    if (!isDict(t)) continue;
    const title = str(t.Name);
    const id = num(t["Track ID"]);
    // Music only: no podcasts, films, audiobooks or videos.
    if (!title || id === undefined || t.Podcast || t.Movie || t["TV Show"] || t["Music Video"] || t["Has Video"]) continue;
    if (typeof t.Kind === "string" && /audiobook|video|pdf/i.test(t.Kind)) continue;
    tracks.push({
      id: String(id),
      title,
      artist: str(t.Artist) ?? str(t["Album Artist"]) ?? "",
      album: str(t.Album),
      durationMs: num(t["Total Time"]),
      explicit: t.Explicit === true,
      inLibrary: !t["Playlist Only"],
      loved: t.Loved === true || t.Favorited === true,
      addedAt: date(t["Date Added"]),
      plays: num(t["Play Count"]) ?? 0,
      playedAt: date(t["Play Date UTC"]),
      skips: num(t["Skip Count"]) ?? 0,
      skippedAt: date(t["Skip Date"]),
    });
  }

  const known = new Set(tracks.map((t) => t.id));
  const playlists: ApplePlaylist[] = [];
  for (const p of Array.isArray(root.Playlists) ? root.Playlists : []) {
    // Apple's own lists (Library, Music, Downloaded…) and folders aren't playlists.
    if (!isDict(p) || p.Master || p["Distinguished Kind"] !== undefined || p.Folder) continue;
    const name = str(p.Name);
    const id = str(p["Playlist Persistent ID"]);
    if (!name || !id) continue;
    const items = Array.isArray(p["Playlist Items"]) ? p["Playlist Items"] : [];
    playlists.push({
      id,
      name: name.slice(0, 100),
      description: str(p.Description)?.slice(0, 300),
      trackIds: items.flatMap((i) => {
        const tid = isDict(i) ? num(i["Track ID"]) : undefined;
        return tid !== undefined && known.has(String(tid)) ? [String(tid)] : [];
      }),
    });
  }
  return { tracks, playlists };
}
