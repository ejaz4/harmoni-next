import type { ProviderPlugin, ProviderRole } from "./types";
import { deezer } from "./deezer";
import { itunes } from "./itunes";
import { lastfm } from "./lastfm";
import { lrclib } from "./lrclib";
import { musicbrainz } from "./musicbrainz";
import { spotify } from "./spotify";
import { tidal } from "./tidal";
import { ytdlp } from "./ytdlp";
import { ytm } from "./ytm";
import { keyFor, serverSettingsNow, type ServerSettings } from "../settings";

const PREFIX_PATTERN = /^[a-z][a-z0-9-]{1,15}$/;
// Public APIs (MusicBrainz, LRCLIB) ask clients to identify themselves.
const USER_AGENT = "Harmoni/0.1 ( https://github.com/ejaz4/harmoni-next )";

export class ProviderRegistry {
  private readonly plugins = new Map<string, ProviderPlugin>();

  // `disabled`: switched off in Server settings. They're still known (for
  // Settings to list) but nothing uses them.
  constructor(
    plugins: ProviderPlugin[],
    private readonly disabled = new Set<string>(),
  ) {
    for (const plugin of plugins) {
      if (!PREFIX_PATTERN.test(plugin.prefix)) {
        throw new Error(`Provider "${plugin.name}" has invalid prefix "${plugin.prefix}"`);
      }
      if (this.plugins.has(plugin.prefix)) {
        throw new Error(`Two providers claim the prefix "${plugin.prefix}"`);
      }
      this.plugins.set(plugin.prefix, plugin);
    }
  }

  get(prefix: string): ProviderPlugin | undefined {
    return this.disabled.has(prefix) ? undefined : this.plugins.get(prefix);
  }

  withRole(role: ProviderRole): ProviderPlugin[] {
    return [...this.plugins.values()].filter((p) => p[role] !== undefined && !this.disabled.has(p.prefix));
  }

  has(prefix: string, role: ProviderRole): boolean {
    return this.get(prefix)?.[role] !== undefined;
  }

  // The switched-on providers that can play a source from `prefix`: its own,
  // and any that play its sources too (yt-dlp for YouTube Music).
  playersFor(prefix: string): ProviderPlugin[] {
    return this.withRole("song").filter((p) => p.prefix === prefix || p.song!.plays?.includes(prefix));
  }

  canPlay(prefix: string): boolean {
    return this.playersFor(prefix).length > 0;
  }

  // Every configured provider, switched on or not.
  all(): { plugin: ProviderPlugin; enabled: boolean }[] {
    return [...this.plugins.values()].map((plugin) => ({ plugin, enabled: !this.disabled.has(plugin.prefix) }));
  }
}

// Providers that need keys, and which keys.
export const KEYED_PROVIDERS = [
  { prefix: "lastfm", name: "Last.fm", keys: ["lastfm"] },
  { prefix: "spotify", name: "Spotify", keys: ["spotifyId", "spotifySecret"] },
  { prefix: "tidal", name: "TIDAL", keys: ["tidalId", "tidalSecret"] },
] as const;

function configuredPlugins(settings: ServerSettings): ProviderPlugin[] {
  const key = (name: Parameters<typeof keyFor>[1]) => keyFor(settings, name);
  const ytdlpUrl = process.env.YTDLP_URL ?? "http://127.0.0.1:3101";
  const plugins = [
    ytm(ytdlpUrl),
    ytdlp(ytdlpUrl), // after ytm, so it's the fallback unless reordered
    deezer(),
    itunes(process.env.ITUNES_COUNTRY ?? "US"),
    musicbrainz(USER_AGENT),
    lrclib(USER_AGENT),
  ];
  const tidalId = key("tidalId");
  const tidalSecret = key("tidalSecret");
  if (tidalId && tidalSecret) plugins.push(tidal(tidalId, tidalSecret, process.env.TIDAL_COUNTRY ?? "US"));
  const spotifyId = key("spotifyId");
  const spotifySecret = key("spotifySecret");
  if (spotifyId && spotifySecret) plugins.push(spotify(spotifyId, spotifySecret));
  const lastfmKey = key("lastfm");
  if (lastfmKey) plugins.push(lastfm(lastfmKey));
  return plugins;
}

// Rebuilt only when the keys or the switched-off providers change, so
// plugins keep their tokens and caches otherwise.
let registry: { signature: string; value: ProviderRegistry } | undefined;

export function getRegistry(): ProviderRegistry {
  const settings = serverSettingsNow();
  const signature = JSON.stringify([settings.keys, settings.disabledProviders]);
  if (registry?.signature !== signature) {
    registry = { signature, value: new ProviderRegistry(configuredPlugins(settings), new Set(settings.disabledProviders)) };
  }
  return registry.value;
}
