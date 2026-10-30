import type { AdminSettings, ProviderRoleName } from "@/lib/admin";
import { trimCache } from "@/server/playback/cache";
import { getRegistry, KEYED_PROVIDERS } from "@/server/providers/registry";
import { withAdmin } from "@/server/session";
import { getServerSettings, KEY_ENV, KEY_NAMES, updateServerSettings, type ServerSettings } from "@/server/settings";

const ROLES: ProviderRoleName[] = ["search", "song", "lyrics", "artist", "discovery"];

function view(settings: ServerSettings): AdminSettings {
  const all = getRegistry().all();
  const known = new Set(all.map((p) => p.plugin.prefix));
  return {
    ...settings,
    keys: Object.fromEntries(
      KEY_NAMES.map((name) => {
        const own = settings.keys[name];
        const env = process.env[KEY_ENV[name]];
        return [name, { set: !!(own || env), fromEnv: !own && !!env, hint: own ? `…${own.slice(-4)}` : undefined }];
      }),
    ),
    providers: all.map(({ plugin, enabled }) => ({ prefix: plugin.prefix, name: plugin.name, enabled, roles: ROLES.filter((r) => plugin[r] !== undefined) })),
    needKeys: KEYED_PROVIDERS.filter((p) => !known.has(p.prefix)).map((p) => ({ prefix: p.prefix, name: p.name, keys: [...p.keys] })),
  };
}

export const GET = withAdmin(async () => Response.json(view(await getServerSettings())));

export const PATCH = withAdmin(async (request) => {
  let patch: unknown;
  try {
    patch = await request.json();
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const before = await getServerSettings();
  const after = await updateServerSettings(patch);
  if (after.cacheLimitGb && after.cacheLimitGb !== before.cacheLimitGb) {
    void trimCache(after.cacheLimitGb * 1e9).catch((err) => console.warn("cache: trimming failed", err));
  }
  return Response.json(view(after));
});
