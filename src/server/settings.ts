import { db } from "./db";

// How this Harmoni is run: who can join, what's switched on, where music
// comes from. Admins change it in Settings → Server. Stored as one JSON row
// so adding a setting never needs a migration; anything missing or malformed
// falls back to the default.

export type SignupMode = "invite" | "open" | "closed";

export interface ServerSettings {
  name: string; // what people see on the sign-in page
  welcome: string; // a line under it, if the admin wants one
  signups: SignupMode;
  invitesBy: "admins" | "everyone";
  inviteDays: number; // how long an invite lasts; 0 = until it's used
  maxAccounts: number; // 0 = no limit
  features: {
    superProcessing: boolean;
    autoplay: boolean;
    link: boolean;
    lyrics: boolean;
  };
  cacheLimitGb: number; // audio cache; 0 = no limit
  disabledProviders: string[];
  songOrder: string[]; // where audio comes from first; others follow in registry order
  lyricsOrder: string[];
  keys: Record<KeyName, string>; // "" = not set here (the environment may have one)
}

export const KEY_NAMES = ["lastfm", "spotifyId", "spotifySecret", "tidalId", "tidalSecret"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

// The environment's value for each key, used when the admin hasn't set one.
export const KEY_ENV: Record<KeyName, string> = {
  lastfm: "LASTFM_API_KEY",
  spotifyId: "SPOTIFY_CLIENT_ID",
  spotifySecret: "SPOTIFY_CLIENT_SECRET",
  tidalId: "TIDAL_CLIENT_ID",
  tidalSecret: "TIDAL_CLIENT_SECRET",
};

const envList = (name: string) =>
  process.env[name]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

export const DEFAULT_SETTINGS: ServerSettings = {
  name: "Harmoni",
  welcome: "",
  signups: "invite",
  invitesBy: "admins",
  inviteDays: 7,
  maxAccounts: 0,
  features: { superProcessing: true, autoplay: true, link: true, lyrics: true },
  cacheLimitGb: 0,
  disabledProviders: [],
  songOrder: envList("PROVIDER_ORDER"),
  // Synced lyrics first: YouTube Music only has plain text.
  lyricsOrder: envList("LYRICS_ORDER").length ? envList("LYRICS_ORDER") : ["lrclib", "ytm"],
  keys: { lastfm: "", spotifyId: "", spotifySecret: "", tidalId: "", tidalSecret: "" },
};

export const INVITE_DAYS = [1, 7, 30, 0];
export const CACHE_LIMITS_GB = [0, 2, 5, 10, 25, 50, 100];

type Patch = { [K in keyof ServerSettings]?: ServerSettings[K] extends object ? Partial<ServerSettings[K]> : ServerSettings[K] };

const text = (v: unknown, fallback: string, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const pick = <T>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const count = (v: unknown, fallback: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback);
const prefixes = (v: unknown, fallback: string[]) =>
  Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === "string" && /^[a-z][a-z0-9-]{1,15}$/.test(p)))].slice(0, 30) : fallback;

// Whatever's stored (or sent), made into valid settings on top of `base`.
export function normalise(raw: unknown, base: ServerSettings = DEFAULT_SETTINGS): ServerSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Patch;
  const f = (r.features && typeof r.features === "object" ? r.features : {}) as Partial<ServerSettings["features"]>;
  const k = (r.keys && typeof r.keys === "object" ? r.keys : {}) as Partial<ServerSettings["keys"]>;
  return {
    name: text(r.name, base.name, 40) || DEFAULT_SETTINGS.name,
    welcome: text(r.welcome, base.welcome, 200),
    signups: pick(r.signups, ["invite", "open", "closed"] as const, base.signups),
    invitesBy: pick(r.invitesBy, ["admins", "everyone"] as const, base.invitesBy),
    inviteDays: pick(r.inviteDays, INVITE_DAYS, base.inviteDays),
    maxAccounts: count(r.maxAccounts, base.maxAccounts, 100_000),
    features: {
      superProcessing: bool(f.superProcessing, base.features.superProcessing),
      autoplay: bool(f.autoplay, base.features.autoplay),
      link: bool(f.link, base.features.link),
      lyrics: bool(f.lyrics, base.features.lyrics),
    },
    cacheLimitGb: pick(r.cacheLimitGb, CACHE_LIMITS_GB, base.cacheLimitGb),
    disabledProviders: prefixes(r.disabledProviders, base.disabledProviders),
    songOrder: prefixes(r.songOrder, base.songOrder),
    lyricsOrder: prefixes(r.lyricsOrder, base.lyricsOrder),
    keys: Object.fromEntries(KEY_NAMES.map((name) => [name, text(k[name], base.keys[name], 200)])) as ServerSettings["keys"],
  };
}

// Each instance keeps a copy for a few seconds: settings are read on hot
// paths (every session check, every provider lookup), and an admin's change
// reaching the other instances a few seconds later is fine.
const FRESH_MS = 10_000;
let snapshot: { value: ServerSettings; at: number } | undefined;
let loading: Promise<ServerSettings> | undefined;

function load(): Promise<ServerSettings> {
  loading ??= db.serverConfig
    .findUnique({ where: { id: "server" } })
    .then((row) => {
      snapshot = { value: normalise(row?.data), at: Date.now() };
      return snapshot.value;
    })
    .finally(() => (loading = undefined));
  return loading;
}

export async function getServerSettings(): Promise<ServerSettings> {
  if (snapshot && Date.now() - snapshot.at < FRESH_MS) return snapshot.value;
  if (snapshot) {
    // Out of date: answer with what's known while the fresh copy loads.
    load().catch((err) => console.warn("settings: reload failed", err));
    return snapshot.value;
  }
  return load();
}

// For code that can't wait (the provider registry): the last copy loaded,
// or the defaults before the first load.
export function serverSettingsNow(): ServerSettings {
  if (!snapshot || Date.now() - snapshot.at >= FRESH_MS) load().catch(() => {});
  return snapshot?.value ?? DEFAULT_SETTINGS;
}

export async function updateServerSettings(patch: unknown): Promise<ServerSettings> {
  const next = normalise(patch, await load());
  await db.serverConfig.upsert({ where: { id: "server" }, create: { id: "server", data: next as object }, update: { data: next as object } });
  snapshot = { value: next, at: Date.now() };
  return next;
}

// An API key: the admin's, else the environment's.
export function keyFor(settings: ServerSettings, name: KeyName): string | undefined {
  return settings.keys[name] || process.env[KEY_ENV[name]] || undefined;
}
