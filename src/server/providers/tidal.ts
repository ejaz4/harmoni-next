import { formatSource } from "../sources";
import { ProviderError } from "./errors";
import type { ProviderPlugin, SongCandidate } from "./types";

const PREFIX = "tidal";
const API = "https://openapi.tidal.com/v2";

interface Resource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string }[] }>;
}

export interface JsonApiDocument {
  data?: Resource | Resource[];
  included?: Resource[];
}

// Official TIDAL API with app credentials (a free app at developer.tidal.com):
// catalogue search and metadata with ISRCs, no subscription. Not an audio source.
export function tidal(clientId: string, clientSecret: string, country: string): ProviderPlugin {
  let token: { value: string; expiresAt: number } | undefined;

  async function getToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 30_000) return token.value;
    const res = await fetch("https://auth.tidal.com/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new ProviderError("AuthFailed", PREFIX, `token request: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function get(path: string, params: URLSearchParams): Promise<JsonApiDocument> {
    params.set("countryCode", country);
    const res = await fetch(`${API}${path}?${params}`, {
      headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/vnd.api+json" },
    });
    if (res.status === 401) {
      token = undefined;
      throw new ProviderError("AuthFailed", PREFIX, "token rejected");
    }
    if (res.status === 429) throw new ProviderError("RateLimited", PREFIX, "too many requests");
    if (!res.ok) throw new ProviderError("Unavailable", PREFIX, `${path}: HTTP ${res.status}`);
    return (await res.json()) as JsonApiDocument;
  }

  return {
    prefix: PREFIX,
    name: "TIDAL",
    // Great metadata but no artwork in these responses, so Deezer/iTunes display first.
    metadataPriority: 25,
    search: {
      async searchSongs(query, limit) {
        // Search returns one results resource listing track ids in rank order;
        // a second call fetches those tracks with their artists and albums.
        // Without include=tracks the response leaves out the track ids entirely.
        const search = await get("/searchResults", new URLSearchParams({ "filter[query]": query, include: "tracks" }));
        const results = Array.isArray(search.data) ? search.data[0] : search.data;
        const ids = (results?.relationships?.tracks?.data ?? []).slice(0, limit).map((r) => r.id);
        if (!ids.length) return [];

        const params = new URLSearchParams({ include: "artists,albums" });
        ids.forEach((id) => params.append("filter[id]", id));
        const tracks = mapTracks(await get("/tracks", params));
        const byId = new Map(tracks.map((t) => [t.source, t]));
        return ids.flatMap((id) => byId.get(formatSource(PREFIX, id)) ?? []);
      },
    },
  };
}

// JSON:API tracks document -> candidates, resolving artists and albums from `included`.
export function mapTracks(doc: JsonApiDocument): SongCandidate[] {
  const included = new Map((doc.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
  const tracks = (Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : []).filter((r) => r.type === "tracks");
  return tracks.map((t): SongCandidate => {
    const a = t.attributes ?? {};
    const title = String(a.title ?? "");
    const version = typeof a.version === "string" && a.version.trim() ? a.version.trim() : undefined;
    const artists = (t.relationships?.artists?.data ?? []).flatMap((ref) => {
      const artist = included.get(`artists:${ref.id}`);
      const name = artist?.attributes?.name;
      return typeof name === "string" ? [{ name, source: formatSource(PREFIX, ref.id) }] : [];
    });
    const albumRef = t.relationships?.albums?.data?.[0];
    const albumTitle = albumRef ? included.get(`albums:${albumRef.id}`)?.attributes?.title : undefined;
    return {
      source: formatSource(PREFIX, t.id),
      // The version ("Live", "Remastered 2011") carries what the matcher reads as tags.
      title: version && !title.toLowerCase().includes(version.toLowerCase()) ? `${title} (${version})` : title,
      artists,
      album: typeof albumTitle === "string" ? { name: albumTitle, source: formatSource(PREFIX, albumRef!.id) } : undefined,
      durationMs: typeof a.duration === "string" ? parseIsoDuration(a.duration) : undefined,
      isrc: typeof a.isrc === "string" ? a.isrc : undefined,
      explicit: a.explicit === true,
    };
  });
}

// "PT3M25S" -> 205000
export function parseIsoDuration(iso: string): number | undefined {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return undefined;
  return Math.round(((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000);
}
