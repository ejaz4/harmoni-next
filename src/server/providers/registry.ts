import type { ProviderPlugin, ProviderRole } from "./types";
import { deezer } from "./deezer";
import { spotify } from "./spotify";
import { ytm } from "./ytm";

const PREFIX_PATTERN = /^[a-z][a-z0-9-]{1,15}$/;

export class ProviderRegistry {
  private readonly plugins = new Map<string, ProviderPlugin>();

  constructor(plugins: ProviderPlugin[]) {
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
    return this.plugins.get(prefix);
  }

  withRole(role: ProviderRole): ProviderPlugin[] {
    return [...this.plugins.values()].filter((p) => p[role] !== undefined);
  }

  has(prefix: string, role: ProviderRole): boolean {
    return this.plugins.get(prefix)?.[role] !== undefined;
  }
}

function enabledPlugins(): ProviderPlugin[] {
  const plugins = [ytm(), deezer()];
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    plugins.push(spotify(process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET));
  }
  return plugins;
}

let registry: ProviderRegistry | undefined;

export function getRegistry(): ProviderRegistry {
  registry ??= new ProviderRegistry(enabledPlugins());
  return registry;
}
