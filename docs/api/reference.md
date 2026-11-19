# Harmoni API reference

Every endpoint the Harmoni web app uses, for building another client against the same server. Paths are relative to the server's origin (for example `https://music.example.com/api/me`).

**Auth.** Every endpoint below needs `Authorization: Bearer <access token>` (see [Building a Harmoni app](README.md)) unless it is marked **public**. That includes the binary endpoints (audio, artwork) and the Link event stream.

**Errors.** A failed request answers with an HTTP status and `{ "error": "message" }`. The message is written for people and can be shown as it is. `401` means the token is missing, expired or revoked: refresh it and retry. The few endpoints that answer differently say so.

## Contents

- [Conventions](#conventions)
- [Types](#types)
- [Server](#server)
- [Me (account and preferences)](#me-account-and-preferences)
- [Search](#search)
- [Songs, albums, artists, lyrics](#songs-albums-artists-lyrics)
- [Playback and history](#playback-and-history)
- [Likes](#likes)
- [Playlists](#playlists)
- [Spices](#spices)
- [People and profiles](#people-and-profiles)
- [Home and autoplay](#home-and-autoplay)
- [Import](#import)
- [Invites](#invites)
- [Harmoni Link](#harmoni-link)

---

## Conventions

**Requests.** Send JSON bodies with `Content-Type: application/json`. Most endpoints read a body they can't parse as `{}`, so a malformed body gets the endpoint's normal validation error (usually `400`). `/api/link` and `/api/import` reject it outright.

**Responses.**
- Optional fields are left out, not sent as `null`, unless a field is documented as nullable.
- Dates are ISO 8601 strings in UTC (`"2026-11-16T09:30:00.000Z"`). Album `releaseDate` is a plain `YYYY-MM-DD` date.
- `204` responses have no body.
- An unexpected server failure answers `500` with a body that is not JSON. Don't assume every error body parses.
- Error responses carry `Cache-Control: no-store`.

**IDs.** Songs, albums, artists, playlists, Spices and playlist items have UUID ids. Song ids must be lowercase: path and body song ids are checked against `^[0-9a-f-]{36}$`, and a mismatch gets `400 {"error":"Invalid song id"}`. Other ids aren't format-checked. An unknown one is just `404`.

**Songs that aren't saved yet.** Search results are returned before they're written to the database, and so are songs found while building artist pages, album tracklists, Spices and autoplay picks. Their ids can be used right away: any endpoint that takes a song id waits for that song's pending save before it runs. Some things to know:
- A new song's `artists[].id` and `album.id` are missing until it's saved. To open its artist or album, fetch [`GET /api/songs/{id}`](#get-apisongsid) first, which waits for the save and returns the ids.
- While saving, a song can turn out to be one Harmoni already had, and its id is then replaced. Endpoints that hand back a song id (for example `PUT /api/likes/{songId}`) return the final one, so use that. The server remembers these replacements in memory only, so after a server restart an old fresh id can answer `404`.

**Lists.** Nothing is paginated. Each list endpoint returns everything, or a fixed number of items that the endpoint documents.

**Caching.** There are no ETags and no conditional requests. JSON responses carry no `Cache-Control` header, so don't keep them in an HTTP cache. The audio and image endpoints set their own `Cache-Control` (documented below).

**Slow first calls.** Several endpoints build their data from outside providers the first time they're asked, and are fast after that. They are artist and album pages, lyrics, Spices, the personal home shelves, autoplay, and audio for a song that isn't cached. A first call can take 10–25 s. Use read timeouts of at least 30 s.

**Server features.** An admin can turn features off for the whole server. Read `server.features` from [`GET /api/me`](#get-apime) and hide what's off. Only Link answers with an error. The others quietly do nothing:

| Feature | When it's off |
|---|---|
| `link` | `GET` and `POST /api/link` answer `403 {"error":"Harmoni Link is off on this server."}` |
| `autoplay` | `POST /api/autoplay` returns `[]`. The account's `autoplay` reads `false`. |
| `superProcessing` | `POST /api/listens` is accepted (`204`) but ignored. `GET /api/home` has no `shelves`. The account's `superProcessing` reads `false`. |
| `lyrics` | `GET /api/lyrics/{id}` returns `{"songId": "...", "found": false}` (no `lines`) |

The account's own `autoplay` and `superProcessing` switches act the same way. In [`Me`](#me), each flag is `true` only when both the person and the server have it on.

---

## Types

These are written as TypeScript. `?` marks an optional field that's left out when it isn't known.

### Song

This is the song object every endpoint returns, from search results to playlists. Pass it around as it is: the Link queue and Link commands carry these objects too.

```ts
interface Song {
  id: string;                 // UUID
  title: string;
  artists: { id?: string; name: string; role: "primary" | "featured" }[]; // id missing until saved
  album?: { id?: string; title: string };                                  // id missing until saved
  durationMs?: number;
  isrc?: string;
  explicit: boolean;
  artworkUrl?: string;        // absolute third-party image URL, needs no auth
  sources: Source[];
}

interface Source {
  uri: string;                // "<provider>:<externalId>", e.g. "ytm:Xb3k0OQ1t0g"
  provider: string;           // "ytm", "deezer", "itunes", "tidal", "spotify", ...
  playable: boolean;          // this provider can stream audio (today only "ytm")
  confidence: number;         // 0–1, how sure the match is
  matchedBy: "origin" | "isrc" | "fuzzy" | "manual";
  rawTitle: string;           // the title as the provider wrote it
}
```

`sources` can be empty, or have no playable entry. That happens for songs brought in by [Import](#import), for example. Such a song can still play: on first play the server looks for a copy to stream. Don't grey out songs because of `sources`.

```json
{
  "id": "3f6c1e0a-8b7d-4c2e-9a51-2d0f7b8e4c11",
  "title": "Midnight City",
  "artists": [{ "id": "a1d0c6e2-5b8f-4c1a-9e3d-7f2b6c8d9e01", "name": "M83", "role": "primary" }],
  "album": { "id": "0b9e7c55-2f3a-4d6b-8c1e-5a4f3e2d1c0b", "title": "Hurry Up, We're Dreaming" },
  "durationMs": 243000,
  "isrc": "FRZ111100211",
  "explicit": false,
  "artworkUrl": "https://lh3.googleusercontent.com/abc123=w544-h544",
  "sources": [
    { "uri": "ytm:dX3k_QDnzHE", "provider": "ytm", "playable": true, "confidence": 1, "matchedBy": "origin", "rawTitle": "Midnight City" },
    { "uri": "deezer:14466355", "provider": "deezer", "playable": false, "confidence": 0.98, "matchedBy": "isrc", "rawTitle": "Midnight City" }
  ]
}
```

### AlbumCard, Album

```ts
interface AlbumCard {
  id: string;
  title: string;
  artworkUrl?: string;
  releaseDate?: string;       // "YYYY-MM-DD"
  kind?: "album" | "ep" | "single" | "compilation";
  trackCount?: number;
}

interface Album extends AlbumCard {
  artists: ArtistCard[];
  label?: string;
  genres: string[];
  songs: Song[];              // in tracklist order
}
```

### ArtistCard, Artist

```ts
interface ArtistCard {
  id: string;
  name: string;
  imageUrl?: string;          // absolute third-party URL
}

interface Artist extends ArtistCard {
  bannerUrl?: string;         // wide banner image
  bio?: string;
  fans?: number;
  popular: Song[];            // up to 10
  latest?: AlbumCard;         // newest release of any kind
  albums: AlbumCard[];        // newest first, as are the next two
  singles: AlbumCard[];       // singles and EPs
  compilations: AlbumCard[];
  related: ArtistCard[];      // similar artists
  yours: Song[];              // up to 5: what this person plays most by them
}
```

### PlaylistSummary, Playlist

```ts
interface PlaylistSummary {
  id: string;
  name: string;
  description?: string;
  count: number;              // number of items
  artworks: string[];         // up to 4 artwork URLs, for a collage cover
  updatedAt: string;
}

interface Playlist {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
  items: { itemId: string; addedAt: string; song: Song }[]; // in order; a song can appear twice
  owner: UserCard;            // who made it
  owned: boolean;             // false: someone else's, shared with you (open and play only)
  visibility: "private" | "link" | "users" | "public";
  shareUrl?: string;          // owner only, while visibility is "link": the path to send, with its key
  sharedWith?: UserCard[];    // owner only: who it's shared with (used while visibility is "users")
}
```

### SpiceCard, Spice

A Spice is a playlist that Harmoni fills, remade at most once a day for whoever opens it. A **search** Spice ("K-Pop", "lofi") is shared and starts from providers' curated lists. A **custom** Spice belongs to one person and starts from songs they picked as seeds.

Each person with Super Processing on also has a **Daily Spice** ("Ejaz's Morning Spice"). It's remade for each part of the day from what they play then, and renames itself to match. It has `kind: "search"` (it can be opened and played but not changed) and carries `daily`. Its id never changes, and `daily` can be used in its place.

```ts
interface SpiceCard {
  id: string;
  name: string;
  kind: "search" | "custom";
  daily?: { part: string; endsAt: string }; // Daily Spice only: "Morning", and when it changes next
  covers: string[];           // up to 3 artwork URLs from inside it
  seedCount?: number;         // custom only
  autoNamed?: boolean;        // custom only: named after its seeds, not by its owner
  updatedAt: string;
}

interface Spice extends SpiceCard {
  owned: boolean;             // true for your custom Spices
  songs: Song[];              // today's mix, up to 50
  seeds: Song[];              // custom only; [] for search Spices
  generatedAt?: string;       // when this mix was made
  expiresAt?: string;         // when opening it next makes a new mix
  daily?: {                   // Daily Spice only
    part: string;             // "Morning", "Friday Night"
    endsAt: string;           // same as expiresAt
    source?: { id: string; name: string }; // the search Spice mixed in right now
    needsSuperProcessing?: boolean;        // true: Super Processing is off, so it's empty
  };
}
```

### Lyrics

```ts
interface Lyrics {
  songId: string;
  found: boolean;
  provider?: string;          // "lrclib", "ytm"
  sync?: "word" | "line" | "none"; // word = karaoke timing, none = plain text
  language?: "ja" | "ko" | "zh";   // only set for these; lines then carry `romanized`
  instrumental?: boolean;
  lines: LyricLine[];         // missing when the server's lyrics feature is off
}

interface LyricLine {
  startMs?: number;           // set for "line" and "word" sync
  endMs?: number;
  text: string;               // "" for an instrumental gap
  words?: { startMs: number; endMs?: number; text: string }[]; // "word" sync; text keeps its trailing space
  romanized?: string;
}
```

### Shelf

These are the personal rows on the home screen.

```ts
type Shelf =
  | { kind: "mix" | "repeat" | "rediscover"; songs: Song[] }
  | { kind: "because"; seed: Song; songs: Song[] }        // "More like <seed>"
  | { kind: "artists" | "top-artists"; artists: ArtistCard[] };
```

`mix` holds new songs picked for them. `repeat` is what's on repeat this month. `rediscover` is loved songs that have gone quiet. `artists` suggests artists they might like. `top-artists` is their own favourite artists.

### Me

```ts
interface Me {
  id: string;
  username: string;
  name: string;               // display name
  role: "admin" | "user";
  superProcessing: boolean;   // on for them AND on this server
  autoplay: boolean;          // on for them AND on this server
  app?: { id: string; name: string }; // only when called with an access token: your client_id and registered name
  avatarUrl?: string;         // their profile picture (see Media URLs)
  accent: string;             // their profile colour, "#a59bff"
  pinned: string[];           // song ids on display on their profile, in order
  server: {
    name: string;
    features: { superProcessing: boolean; autoplay: boolean; link: boolean; lyrics: boolean };
    canInvite: boolean;       // may this person create invites
    inviteDays: number;       // how long a new invite lasts; 0 = until used
  };
}
```

---

## Server

### `GET /api/setup`

**Public**: no token needed. Tells you what the server calls itself and who can join. Use it on a sign-in screen.

```json
{ "needsAdmin": false, "name": "Harmoni", "welcome": "Music for the house.", "signups": "invite" }
```

| Field | Meaning |
|---|---|
| `needsAdmin` | No accounts exist yet. The first account to sign up becomes admin and needs no invite. |
| `name`, `welcome` | The server's name, and an optional line under it (`""` if none). |
| `signups` | `"open"` (anyone can sign up), `"invite"` (sign-up needs an invite code) or `"closed"`. It reads `"closed"` when the server is at its account limit, and always `"open"` while `needsAdmin` is true. |

---

## Me (account and preferences)

### `GET /api/me`

Returns the signed-in person and what the server allows. Response: `200` with a [`Me`](#me) object.

```json
{
  "id": "u_8YzQ2kLm",
  "username": "sam",
  "name": "Sam",
  "role": "user",
  "superProcessing": true,
  "autoplay": true,
  "app": { "id": "hcl_p14zbnVkwXcP5C-61qxwmQ", "name": "Harmoni for Android" },
  "server": {
    "name": "Harmoni",
    "features": { "superProcessing": true, "autoplay": true, "link": true, "lyrics": true },
    "canInvite": false,
    "inviteDays": 7
  }
}
```

### `PATCH /api/me`

Changes the display name and preferences. Send any of these fields:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Trimmed and cut to 60 characters. An empty string gets `400 "Your name can't be empty."` |
| `superProcessing` | boolean | Learns from listening, which powers the home shelves and personal Spices and autoplay. It must be a JSON boolean, or it's ignored. |
| `autoplay` | boolean | Keeps playing similar songs when the queue runs out. JSON boolean only. |

**Response:** `200` with the updated [`Me`](#me).

**Errors:** `400 "Nothing to change."` if no valid field was sent.

**Notes:**
- The stored choice is kept even if the server has the feature off. The response shows the effective value (`false`), and the feature turns on for this person if an admin turns it on later.
- When `superProcessing` goes from off to on, the server counts their existing play history and starts building their home shelves in the background.

### `DELETE /api/me/listening`

Forgets everything Super Processing has learned: listens, per-song stats and home shelves. Likes, playlists and play history stay. Response: `204`.

---

## Search

### `GET /api/search`

Searches every provider for songs and merges the results into canonical [`Song`](#song)s.

| Query param | Required | Notes |
|---|---|---|
| `q` | yes | Trimmed. Missing or blank gets `400 {"error":"Missing ?q= parameter"}`. |
| `stream` | no | `1` streams results as each provider answers (recommended). Anything else waits for all of them. |

Each provider gets 5 s and returns at most 10 songs, so a search finishes in about 5 s at most.

#### Without `stream=1`

`200` with one JSON object:

```json
{
  "query": "midnight city",
  "providers": [
    { "prefix": "ytm", "name": "YouTube Music", "ok": true, "count": 10, "ms": 812 },
    { "prefix": "tidal", "name": "TIDAL", "ok": false, "error": "[tidal] Timeout: no response after 5000ms", "count": 0, "ms": 5001 }
  ],
  "results": [ /* Song, best first */ ],
  "tookMs": 5004
}
```

This form never includes the search's Spice.

#### With `stream=1`: NDJSON

`Content-Type: application/x-ndjson`, `Cache-Control: no-cache`. The body is one JSON object per line, each ending in `\n`. Lines arrive in this order:

1. `{"type":"start","query":"...","providers":[{"prefix":"ytm","name":"YouTube Music"}, ...]}`, once.
2. `{"type":"provider","status":{ProviderStatus},"results":[Song, ...]}`, one per provider as it finishes. **`results` is the whole merged list so far, best first.** Replace what you show with it; don't append. Songs can reorder between events, and a song from an earlier event can disappear because it was merged into another one.
3. `{"type":"done","tookMs":4980}`, once.

Two other lines can appear:
- `{"type":"spice","spice":{SpiceCard}}`: the [Spice](#spicecard-spice) for this search, when the query names a genre, mood or scene (for example "k-pop"). It can come at any point **after** `start`, **including after `done`**. If it isn't known by `done`, the server waits up to 3 s more for it before closing.
- `{"type":"error","error":"..."}`: the search failed. The stream ends after it.

**Read until the stream ends, not until `done`.** Showing results as soon as `done` arrives is fine, but keep reading to catch a late `spice` line.

Consuming it with OkHttp:

```kotlin
val call = client.newCall(Request.Builder()
    .url("$base/api/search?stream=1&q=${URLEncoder.encode(q, "UTF-8")}")
    .header("Authorization", "Bearer $token").build())
call.execute().use { res ->
    if (!res.isSuccessful) error("search failed: ${res.code}")
    val source = res.body!!.source()
    while (true) {
        val line = source.readUtf8Line() ?: break     // null = stream ended
        if (line.isBlank()) continue
        val event = JSONObject(line)
        when (event.getString("type")) {
            "provider" -> showResults(event.getJSONArray("results"))  // replace, don't append
            "spice"    -> showSpice(event.getJSONObject("spice"))
            "done"     -> markFinished()
            "error"    -> markFailed(event.getString("error"))
        }
    }
}
// To abandon a search (the person typed more), call.cancel(). The server stops too.
```

The web app waits 300 ms after the last keystroke before searching, and cancels the previous search when a new one starts.

---

## Songs, albums, artists, lyrics

### `GET /api/songs/{id}`

Returns one song as a [`Song`](#song). If a fresh search result is still being saved, this waits for the save, so it's the way to get a new song's artist and album ids.

**Errors:** `400` invalid id, `404 "Not found."`

### `GET /api/songs/{id}/artwork`

Returns the song's cover image **bytes**, fetched from the stored `artworkUrl` and passed through (not a redirect).

- `200`: `Content-Type` is the upstream image type (`image/jpeg`, ...), with `Cache-Control: private, max-age=604800, immutable`.
- `404` with an empty body when the song has no artwork (or doesn't exist). `502` with an empty body when the upstream fetch fails or doesn't return an image. `400` (JSON) for an invalid id.

The web app uses this so the browser can read the image's pixels for colours, which third-party CDNs don't allow. **A native client can load `artworkUrl` directly**, with no auth. Use this endpoint only if you need same-origin bytes, and send the token with it.

### `GET /api/albums/{id}`

Returns the album page as an [`Album`](#albumcard-album).

The first visit fetches the tracklist from a provider (up to about 12 s). Later visits are served from the database and refreshed in the background every 30 days. If no provider has a tracklist, `songs` is the album's songs that Harmoni already knows. Tracklist songs may be fresh, not yet saved (see [Conventions](#conventions)).

**Errors:** `404`.

### `GET /api/artists/{id}`

Returns the artist page as an [`Artist`](#artistcard-artist).

The first visit builds the artist's profile from providers, which takes a few seconds. After that it's served from cache and rebuilt in the background weekly. `popular` may contain fresh songs. If providers have nothing, `popular` falls back to this artist's songs already in Harmoni, ordered by this person's plays.

**Errors:** `404`.

### `GET /api/artists/{id}/image`

Returns the artist's photo bytes, the same way as song artwork: proxied, `Cache-Control: private, max-age=604800`, `404`/`502` with empty bodies. A native client can load `imageUrl` directly instead.

### `GET /api/lyrics/{id}`

Returns the song's lyrics as [`Lyrics`](#lyrics).

```json
{
  "songId": "3f6c1e0a-8b7d-4c2e-9a51-2d0f7b8e4c11",
  "found": true,
  "provider": "lrclib",
  "sync": "line",
  "language": "ja",
  "instrumental": false,
  "lines": [
    { "startMs": 15200, "text": "夜明けの街を", "romanized": "yoake no machi wo" },
    { "startMs": 21480, "text": "" },
    { "startMs": 24010, "text": "君と歩いた", "romanized": "kimi to aruita" }
  ]
}
```

- `found: false` with `lines: []` means no provider had lyrics. That result is cached too, and checked again every few days.
- The first request for a song waits on the providers, which are tried in order with up to 12 s each. Later requests answer from cache straight away, even when a recheck is due. The recheck runs in the background, and the next request sees anything better.
- `songId` is the song's final id. That can differ from the id you asked with if the song was merged (see [Conventions](#conventions)).
- With the server's lyrics feature off, you get `200 {"songId": "<the id you sent>", "found": false}` and **no `lines` field**.

**Errors:** `400` invalid id, `404 "No song <id>"`.

---

## Playback and history

### `GET /api/play/{id}`

Returns the song's **audio bytes**. Point the player straight at this URL. The server finds a source (its own cache first, then each provider in turn, then a search for more copies) and streams the audio through itself. It never redirects.

**Request:** the `Authorization` header, plus optionally `Range: bytes=<start>-[<end>]` or `bytes=-<suffix>`. Only one range is supported.

**Response headers:**

| | Cached on the server | Streaming from a provider |
|---|---|---|
| `Content-Type` | Stored type | Upstream type |
| `Accept-Ranges` | `bytes` | `bytes`, or `none` when the size is unknown |
| `Content-Length` | Always | When the size is known |
| `Cache-Control` | `private, max-age=86400` | `no-store` |
| `X-Harmoni-Source` | `cache (ytm:<id>)` | `ytm:<id>` |

The content type is normally `audio/mp4` (AAC in M4A). It can be `audio/webm` (Opus) when that's all the source has.

**Status:**
- `200`: the whole file (no `Range`, or a range the server couldn't honour; see below).
- `206 Partial Content` with `Content-Range: bytes s-e/total`: a range was served.
- `416` with `Content-Range: bytes */total`: the range starts past the end.
- `400 {"error":"Invalid song id"}`.
- `404 {"error":"No song <id>"}`: no such song.
- `502 {"error":"No playable source for \"<title>\"", "attempts":["ytm:abc: NotFound", ...]}`: every source failed. Skip to the next song.

**How ranges behave:**
- **Cached songs** are a local file: every range works and seeking is instant.
- **Uncached songs** are fetched from the provider starting at the requested offset, so seeking works before the song is cached. Each request at a new offset makes the server resolve the provider again, which takes about a second or more.
  - If the provider can't start at that offset, the server answers `200` with the body from byte 0 and `Content-Length` of the whole file. ExoPlayer's HTTP data sources handle this by skipping ahead.
  - A suffix range (`bytes=-500`) on an uncached song always gets the whole file with `200`.
  - When the provider doesn't report a size, the response is `200`, `Accept-Ranges: none` and has no `Content-Length`. That song can't be seeked until it's cached.
- **Caching:** a request that starts at byte 0 also saves the song on the server as it streams. The save keeps going even if the client disconnects (for example, to seek), and from then on the song is served from cache. Requests that start elsewhere don't cache.
- **Warming up the next song:** `GET /api/play/{nextId}` with `Range: bytes=0-0` gets one byte back, and the server fetches and caches the whole song in the background. The web app does this 10 s into the current song.
- **Avoid `HEAD`.** Next.js answers `HEAD` by running the full `GET`, which resolves a provider and starts caching for nothing.

**Timing:** the first byte of an uncached song can take several seconds. The server allows up to 20 s per source and then searches for more copies. Set the player's connect and read timeouts to 30 s or more (ExoPlayer's default is 8 s).

**ExoPlayer setup.** Inject the token per request so that a refreshed token is picked up mid-queue:

```kotlin
val http = OkHttpDataSource.Factory(okHttp)            // okHttp with readTimeout ≥ 30 s
val authed = ResolvingDataSource.Factory(http) { spec ->
    spec.withAdditionalHeaders(mapOf("Authorization" to "Bearer ${tokens.current()}"))
}
val player = ExoPlayer.Builder(context)
    .setMediaSourceFactory(DefaultMediaSourceFactory(authed))
    .build()
player.setMediaItem(MediaItem.fromUri("$base/api/play/${song.id}"))
```

A `401` mid-queue means the token expired between requests. Refresh it and retry that item.

### `POST /api/plays`

Records that a song was listened to. This is the play history: it feeds "recently played", "your top songs" on artist pages, and Spice suggestions. Call it **once per playback**, when the playhead first reaches `min(30 s, duration / 2)`. That's the web app's rule.

| Body field | Type | Required |
|---|---|---|
| `songId` | string (song id) | yes |

**Response:** `204`. **Errors:** `400` invalid id, `404` unknown song.

### `GET /api/plays`

Returns recently played songs, most recent first, each song once.

| Query param | Notes |
|---|---|
| `limit` | Default 50, max 200. `0` or non-numeric means 50. Negative values aren't rejected and give odd results, so send a positive number. |

**Response:** `200` with `Song[]`.

### `POST /api/listens`

A detailed report for Super Processing, sent **each time a song stops being the current one** (it ended, was skipped, the app closed, and so on). It's separate from `POST /api/plays`. The server ignores it with `204` when the account (or server) has Super Processing off, so you can skip sending it when `Me.superProcessing` is false.

| Body field | Type | Required | Notes |
|---|---|---|---|
| `songId` | string | yes | |
| `playedMs` | number | yes | Time actually spent playing, not counting seeks. Max 6 h. Reports under 2000 ms are ignored. |
| `positionMs` | number | yes | Where the playhead was when it stopped. Max 6 h. |
| `durationMs` | number | no | The song's length as the player saw it. |
| `reason` | string | yes | `"ended"`, `"skip"` (forward), `"back"` (previous), `"close"` (app or player closed) or `"error"` |
| `heard` | integer | no | A bitmask of which 5% slices of the song were heard. Bit *i* (0–19) covers `[i×5%, (i+1)×5%)`. Max `2^20 − 1`. |
| `replays` | integer | no | Times they dragged back over a part already heard. Max 100. |
| `context` | string | no | `"autoplay"` if autoplay added this song to the queue. |

**Response:** `204`. **Errors:** `400 "Invalid listen"` if a required field is missing or invalid. That check only runs when Super Processing is on. An unknown song is ignored silently.

The web app sends this with `sendBeacon` so it survives the page closing. On Android, send it from somewhere that outlives the UI (for example a `WorkManager` job), and accept that a few can get lost.

---

## Likes

### `GET /api/likes`

| Query param | Notes |
|---|---|
| `ids` | `1` returns only the liked song ids, as `string[]` (useful for heart icons). Otherwise you get `Song[]`, newest like first. |

All likes are returned, with no limit.

### `PUT /api/likes/{songId}`

Likes a song. Doing it again is harmless.

**Response:** `200 {"songId": "<final id>", "liked": true}`. The returned `songId` can differ from the one you sent if the song was merged while saving. Store the returned one.

**Errors:** `400` invalid id, `404` unknown song.

### `DELETE /api/likes/{songId}`

Unlikes a song. **Response:** `200 {"songId": "...", "liked": false}`, even if it wasn't liked.

---

## Playlists

Only the owner can change a playlist. Who else can open it depends on its `visibility`:

| `visibility` | Who can open it |
|---|---|
| `private` (default) | Only the owner. |
| `link` | Anyone signed in to this server who has the link. The link is `shareUrl`, which carries a `?key=`. |
| `users` | The people it's shared with (`PUT /api/playlists/{id}/shares`). It appears in their [`GET /api/playlists/shared`](#get-apiplaylistsshared). |
| `public` | Everyone signed in to this server. It is also listed on the owner's profile. |

A playlist someone can't open gets `404`, the same as a playlist that doesn't exist. Shared playlists are view-only. Changing someone else's playlist, or its items, gets `404`.

### `GET /api/playlists`

Returns your playlists, most recently changed first, as `PlaylistSummary[]` (see [Types](#playlistsummary-playlist)).

### `POST /api/playlists`

Creates a playlist.

| Body field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | Trimmed, max 100. Blank gets `400 "Give the playlist a name."` |
| `description` | string | no | Trimmed, max 500. |

**Response:** `201 {"id": "...", "name": "..."}`.

### `GET /api/playlists/shared`

Other people's playlists shared with you (visibility `users`), most recently changed first, as `(PlaylistSummary & { owner: UserCard })[]`.

### `GET /api/playlists/{id}`

Returns a [`Playlist`](#playlistsummary-playlist) with its items in order: yours, or someone else's that you can open. For a playlist shared by link, pass the link's key as `?key=`. A link opened in your app looks like `/playlist/{id}?key=...`. **Errors:** `404`.

### `PATCH /api/playlists/{id}`

Renames the playlist, changes its description, or changes who can open it. Send any of the fields.

| Body field | Type | Notes |
|---|---|---|
| `name` | string | Trimmed, max 100. Present but blank gets `400`. |
| `description` | string or null | Trimmed, max 500. `null` or `""` clears it. |
| `visibility` | string | `private`, `link`, `users` or `public`. Switching to `link` makes a link. Switching away keeps it, so switching back brings back the same link. |
| `resetLink` | boolean | `true` makes a new link, and the old one stops working. |

**Response:** `200 {"id", "name", "description", "visibility", "shareUrl"?}`. Here `description` is `null` when there is none, and `shareUrl` is set while visibility is `link`. **Errors:** `400`, `404`.

### `PUT /api/playlists/{id}/shares`

Sets who the playlist is shared with, replacing the whole list. It only takes effect while visibility is `users`. The list is kept while it isn't.

| Body field | Type | Notes |
|---|---|---|
| `usernames` | string[] | At most 200. Unknown usernames, suspended people and you are skipped. |

**Response:** `200` with the people it's now shared with, as `UserCard[]`. **Errors:** `400`, `404`.

### `DELETE /api/playlists/{id}`

**Response:** `204`. **Errors:** `404`.

### `POST /api/playlists/{id}/items`

Adds a song at the end. The same song can be added more than once.

| Body field | Type | Required |
|---|---|---|
| `songId` | string | yes |

**Response:** `201 {"itemId": "..."}`. **Errors:** `400` invalid song id, `404` playlist or song not found.

### `DELETE /api/playlists/{id}/items/{itemId}`

Removes one item. It takes the `itemId`, not the song id, so duplicates can be told apart.

**Response:** `204`, even if no such item existed. **Errors:** `404` if the playlist isn't yours.

---

## Spices

See [SpiceCard, Spice](#spicecard-spice) for the shapes. Search Spices come from the search stream's `spice` line. Anyone can open them, but only custom Spices can be changed, and only by their owner. Changing a search Spice, or someone else's Spice, gets `404`.

### `GET /api/spices`

Returns your custom Spices, most recently changed first, as `SpiceCard[]`. With Super Processing on, your Daily Spice comes first. Apps that show it in a place of their own can pass `?daily=false` to leave it out.

### `POST /api/spices`

Creates a custom Spice from seed songs.

| Body field | Type | Required | Notes |
|---|---|---|---|
| `seedIds` | string[] | no | Song ids, at most 50, in the order picked. Default `[]`. |
| `name` | string | no | Trimmed, max 60. Without a name, the Spice is named after its seeds' artists and renames itself as the seeds change (`autoNamed: true`). |

**Response:** `201` with a `SpiceCard`. Seed ids that don't exist are dropped.

**Errors:** `400 "Invalid seed songs"` (not an array, more than 50, or a bad id). `404` if you sent seeds and none of them exist.

### `GET /api/spices/suggestions`

Suggests songs to pick seeds from before searching: what they've been playing lately, plus their plays and likes, at most two per artist. **Response:** `Song[]`, up to 30.

### `GET /api/spices/{id}`

Opens a Spice and returns a [`Spice`](#spicecard-spice).

Opening is what remakes the mix: once a day per person, or straight away after its seeds change. The first open has nothing to show yet, so it waits for the mix to be made, which can take 10 s or more. After that, if today's mix takes more than 4 s, yesterday's is returned and today's lands on the next open. `songs` can include fresh songs.

**Errors:** `404` if it doesn't exist or it's someone else's custom Spice.

### `PATCH /api/spices/{id}`

| Body field | Type | Notes |
|---|---|---|
| `name` | string or null | Required. A non-blank string (trimmed, max 60) renames it. `null` goes back to naming it after its seeds. |

**Response:** `204`. **Errors:** `400 "Give the Spice a name."` (missing, blank or not a string), `404`.

### `DELETE /api/spices/{id}`

**Response:** `204`. **Errors:** `404`.

### `POST /api/spices/{id}/seeds`

Adds one seed.

| Body field | Type | Required |
|---|---|---|
| `songId` | string | yes |

**Response:** `204`. **Errors:** `400`, `404` (Spice or song).

### `PUT /api/spices/{id}/seeds`

Replaces all seeds, in order.

| Body field | Type | Required | Notes |
|---|---|---|---|
| `songIds` | string[] | yes | 1–50 song ids. Ids that don't exist are dropped. If none exist, the Spice is left with no seeds (no error). |

**Response:** `204`. **Errors:** `400 "Invalid seed songs"`, `404`.

### `DELETE /api/spices/{id}/seeds/{songId}`

Removes one seed. Use the song's saved id, as it appears in `Spice.seeds`.

**Response:** `204`, even if that song wasn't a seed. **Errors:** `404` if the Spice isn't yours.

### `POST /api/spices/{id}/snapshot`

Saves today's mix as an ordinary playlist that won't change. It works for search Spices too.

**Response:** `201 {"id": "<playlist id>", "name": "K-Pop Spice, 16 Nov"}`. **Errors:** `404`.

---

## People and profiles

Everyone signed in to a server can find and see each other's profiles. A profile shows what its owner chooses: songs they put on display, their public playlists and their liked songs (each of the last two can be hidden). Following is one way and needs no approval. People can follow back.

**Media URLs.** `avatarUrl` and `bannerUrl` are paths on the server (`/api/media/<name>.webp`). They are **public**, so load them without a token. A new picture always gets a new URL, so they can be cached for good.

**Links.** The web app's links are `/u/{username}` for a profile, `/song/{id}` for a song and `/playlist/{id}` for a playlist (with `?key=` for a link-only one). An app that handles these URLs can open the matching screen.

```ts
interface UserCard {
  id: string;
  username: string;
  name: string;
  avatarUrl?: string;
  accent: string;             // their profile colour
  youFollow?: boolean;        // missing when it's you
  followsYou?: boolean;       // missing when it's you
}

interface Profile {
  user: UserCard;
  isMe: boolean;
  bio?: string;
  accent: string;             // "#a59bff"
  font: "default" | "serif" | "elegant" | "grotesk" | "display" | "rounded" | "mono" | "condensed" | "script" | "pixel";
  banner: "glow" | "aurora" | "sunset" | "tide" | "stripes" | "dots" | "grid" | "plain" | "image";
  bannerUrl?: string;         // when banner is "image"
  followers: number;
  following: number;
  pinned: Song[];             // on display, in order (up to 10)
  likes?: { count: number; songs: Song[] };  // newest 20; missing when hidden (always there on your own)
  playlists?: PlaylistSummary[];             // public ones; missing when hidden (always there on your own)
  showLikes: boolean;
  showPlaylists: boolean;
  joinedAt: string;
}
```

The fonts and banners are presets the web app draws. Banners are drawn from `accent`. An app can approximate them, or just use `accent`.

### `GET /api/users?q=`

Searches people by name or username (a leading `@` is ignored). Exact usernames come first, then people you follow. Returns `UserCard[]`, at most 20. Suspended accounts never appear.

### `GET /api/users/{username}`

Returns a [`Profile`](#people-and-profiles). Usernames match regardless of case. **Errors:** `404`.

### `GET /api/users/{username}/likes`

All their liked songs, newest first, as `Song[]`. **Errors:** `404` if they hide them.

### `GET /api/users/{username}/followers`, `GET /api/users/{username}/following`

`UserCard[]`, newest first.

### `PUT /api/users/{username}/follow`, `DELETE /api/users/{username}/follow`

Follows or unfollows them. Both are safe to repeat. **Response:** `200` with their `UserCard`. **Errors:** `400 "You can't follow yourself."`, `404`.

### `GET /api/me/profile`

Your own [`Profile`](#people-and-profiles).

### `PATCH /api/me/profile`

Changes your profile. Send any of the fields. Each is checked, and a bad one gets `400` with a message saying what's wrong.

| Body field | Type | Notes |
|---|---|---|
| `name` | string | Your display name. Trimmed, max 60, not blank. |
| `bio` | string or null | Trimmed, max 300. |
| `accent` | string or null | `#rrggbb`. `null` goes back to the default. |
| `font` | string or null | One of the `font` values. |
| `banner` | string or null | One of the preset `banner` values (not `"image"`). Picking one removes an uploaded banner. |
| `pinnedSongs` | string[] | Song ids, in order, at most 10. Unknown ids are dropped. |
| `showLikes`, `showPlaylists` | boolean | |

**Response:** `200` with your updated `Profile`.

### `PUT /api/me/profile/avatar`, `PUT /api/me/profile/banner`

Uploads a picture. The request body is the image itself (JPEG, PNG, WebP, GIF or AVIF) with its `Content-Type`, at most 10 MB. It is cropped to fit (512×512 for an avatar, 1800×600 for a banner) and stored as WebP. Uploading a banner makes `banner` `"image"`.

**Response:** `200 {"url": "/api/media/....webp"}`. **Errors:** `400` (not a readable picture), `413` (too big).

### `DELETE /api/me/profile/avatar`, `DELETE /api/me/profile/banner`

Removes the picture. **Response:** `204`.

### `PUT /api/me/profile/pins/{songId}`, `DELETE /api/me/profile/pins/{songId}`

Puts a song on display at the end of the list, or takes it off. **Response:** `200 {"pinned": ["<song id>", ...]}`. **Errors:** `400` when there are already 10, `404` unknown song.

---

## Home and autoplay

### `GET /api/home`

Returns everything for the home screen.

```json
{
  "recent": [ /* Song, up to 12, most recently played first */ ],
  "liked": [ /* Song, up to 12, newest like first */ ],
  "playlists": [ /* PlaylistSummary, up to 8 */ ],
  "shelves": [ /* Shelf, in display order */ ]
}
```

`shelves` is left out entirely when the person (or server) has Super Processing off. Otherwise it's a list of [`Shelf`](#shelf)s, which may be empty while there's too little listening to go on. The shelves are worked out in the background and stored, so this is normally fast. The very first call for a person waits while they're built, which takes several seconds.

### `POST /api/autoplay`

Asks for more songs when the queue is about to run out. The web app asks when one song is left after the current one, and only on the device that's playing.

| Body field | Type | Required | Notes |
|---|---|---|---|
| `seeds` | string[] | yes | Song ids: the current song first, then the ones before it. Only the first 3 valid ids are used. |
| `exclude` | string[] | no | Song ids already in the queue, so they aren't suggested again. Up to 500 are used. |

**Response:** `200` with `Song[]`, up to 10, often including fresh songs. You get `[]` if autoplay is off for the person or the server. That check happens before validation. The server waits up to 12 s for a song's radio to be built, so the first call for a new song can be slow. It may also return fewer songs, or none, and a retry a few seconds later can do better. The web app retries 3 times, 8 s apart.

When you add these songs to the queue, mark them `"autoplay": true` (see [LinkState](#link-types)), and send `context: "autoplay"` in their [listens](#post-apilistens).

**Errors:** `400 "Nothing to go on."` if there's no valid seed.

---

## Import

Brings in a library from Apple Music or Spotify on top of what the person has: their library becomes likes, playlists are copied, and their listening becomes listening history. The web app reads the files on the device and sends only a summary; a client must build the same summary itself. The reference mappings are `readAppleLibrary()` in `src/lib/apple-library.ts` (Apple's `Library.xml`) and `readSpotifyExport()` in `src/lib/spotify-library.ts` (the JSON files in Spotify's data downloads).

### `POST /api/import`

The body is an `ImportLibrary`:

```ts
interface ImportLibrary {
  source?: "apple" | "spotify"; // default "apple"
  tracks: {
    id: string;               // the service's id for it (≤ 40 chars): Apple "Track ID", Spotify track id; tracks without id or title are dropped
    title: string;            // ≤ 300
    artist: string;
    album?: string;           // also used for matching: tracks on a live album count as live
    durationMs?: number;
    explicit: boolean;
    inLibrary: boolean;       // true = in their library (liked); false = only in a playlist or their history
    loved: boolean;
    addedAt?: string;         // ISO date; liked songs keep it
    plays: number;            // Apple: counted as listening (ignored when `listens` is sent)
    playedAt?: string;
    skips: number;
    skippedAt?: string;
  }[];
  playlists: {
    id: string;               // stable across exports (≤ 120 chars): Apple "Playlist Persistent ID", Spotify playlist name
    name: string;             // ≤ 100
    description?: string;
    trackIds: string[];       // track ids, in order; unknown ids are dropped
  }[];
  // Every play, one by one (Spotify). When present, each becomes a listen at
  // the time it happened, and the tracks' plays and skips are ignored.
  listens?: [
    track: number,            // index into `tracks`
    at: number,               // when it stopped, Unix seconds
    playedMs: number,         // how long it played
    end: number,              // index into ["unknown", "ended", "skip", "back", "close"]
  ][];
}
```

Limits: at least 1 and at most 60,000 tracks, at most 2,000 playlists, at most 20,000 tracks per playlist, and at most 600,000 listens.

Bringing a library in again adds only what's new. Playlists with the same `id` are updated, and songs the person added on Harmoni since are kept. Apple play counts add only the difference since the last Apple import. A Spotify play is skipped if the same song was brought in from Spotify within a minute of it, so overlapping downloads (Account data, then Extended streaming history) can be sent in any order. Listens from Spotify are recorded with `context: "spotify"`.

**Response:** `202` with an `ImportProgress` (below). The work carries on in the background.

**Errors (`400`):** `"That isn't a library."`, `"There are no songs in that library."`, `"That library is too big to bring in."`, `"A library is already being brought in."` (one is still in the `adding` phase). Starting a new import while the last one is still `improving` ends that phase, and the new import carries on from there.

### `GET /api/import`

Returns how the latest import is going: an `ImportProgress`, or `null` if they've never imported. The web app polls every 1.5 s while `adding` and every 5 s while `improving`.

```ts
interface ImportProgress {
  id: string;
  source: "apple" | "spotify";
  status: "adding" | "improving" | "done" | "failed" | "cancelled";
  total: number;              // tracks in the file
  done: number;               // tracks added so far (adding phase)
  known: number;              // of those, how many matched songs Harmoni already had
  toImprove: number;          // songs made from the file's details, to look up on providers
  improved: number;           // how many of those have been looked up
  found: number;              // how many of those a provider had
  summary?: {                 // set once adding finishes
    source?: "apple" | "spotify";
    liked: number;
    playlists: { name: string; songs: number }[];
    listening: number;        // songs whose plays and skips were counted
    listens?: number;         // Spotify: plays brought in, one by one
    appliedAt: string;
    missing?: { title: string; artist: string }[]; // set when done: no provider had these
  };
  error?: string;             // when failed
  createdAt: string;
  finishedAt?: string;
}
```

The phases run in this order. `adding` puts every track in, as an existing song or a new one made from the file's details, then applies likes, playlists and listening. `improving` slowly looks the new songs up on providers to get artwork and details; it can take a long time, and the library is already usable. Then `done`.

### `DELETE /api/import`

Stops the import. During `adding`, nothing is added and the status becomes `cancelled`. During `improving`, what's done is kept and the status becomes `done`. **Response:** `200` with the latest `ImportProgress` (or `null`).

---

## Invites

Who may invite depends on server settings. Admins may invite unless sign-ups are `closed`. Other people may invite only when the admin has allowed everyone to invite and sign-ups aren't `closed`. `Me.server.canInvite` gives you the answer up front.

### `GET /api/invites`

Lists invites, newest first, up to 100. Admins see everyone's. Everyone else sees their own.

```json
[
  { "code": "7KQM-X2PA", "createdAt": "2026-11-15T18:02:11.000Z", "expiresAt": "2026-11-22T18:02:11.000Z", "usedAt": null, "usedBy": null, "createdBy": null },
  { "code": "B9TR-4HWN", "createdAt": "2026-11-10T09:00:00.000Z", "expiresAt": null, "usedAt": "2026-11-11T20:14:52.000Z", "usedBy": "alex", "createdBy": "Jo" }
]
```

`expiresAt` is `null` when the invite lasts until used. `usedBy` is the username of whoever used it. `createdBy` is `null` for your own invites and the creator's name for others' (admins only).

**Errors:** `403 "Inviting people is up to the admins here."` for a non-admin who may not invite. Admins can always list.

### `POST /api/invites`

Creates a one-time invite. The code looks like `XXXX-XXXX` and uses no 0, O, 1, I or L. It lasts `Me.server.inviteDays` days, or until used when that's 0. No body is needed.

**Response:** `201 {"code": "7KQM-X2PA", "expiresAt": "2026-11-23T10:00:00.000Z"}`.

**Errors:** `403` when not allowed. That includes admins while sign-ups are `closed`.

### `DELETE /api/invites?code=XXXX-XXXX`

Takes back an **unused** invite: your own, or anyone's if you're an admin.

**Response:** `200 {"deleted": true}`. If nothing matched (wrong code, already used, or not yours), you get `404 {"deleted": false}`. This error body has no `error` field.

---

## Harmoni Link

Harmoni Link works like Spotify Connect. Each account has **one playback**: a queue, a position in it, and play/pause. It plays on **one device at a time** (the *active* device). Every other device of the same account that's connected acts as a **remote**: it shows what's playing, with a live playhead, and its controls go to the active device.

The server relays messages and stores the playback. It keeps the state the active device last reported and passes commands from remotes to the active device, which carries them out. It never plays anything itself, and it barely looks inside songs.

### How it fits together

- **Device.** Each device has an id, a name and a kind. **Keep the id stable for each app install**: generate a UUID on first launch and store it. A device is *online* while its event stream is connected. The server re-lists it on every ping. A device with no ping for 45 s drops off the list, and one whose stream closes is still listed for 8 s in case it comes back.
- **Event stream** (`GET /api/link`, Server-Sent Events). This is how the server reaches the device: who's online, who's playing, playback changes and commands.
- **POST** `/api/link`. This is everything a device says: its playback (if it's the active device), a command for the active device, or moving playback to another device.
- **Server time.** `hello`, `devices` and `ping` events carry `now`, the server's clock in ms. Keep `offset = now − System.currentTimeMillis()`, updated on each of those events. Playback times (`at`) and device expiry (`until`) are in server time.
- **The playhead** isn't sent continuously. The active device reports `positionMs` together with `at` (server time), and anyone can work out where it is now:

  ```
  positionNow = positionMs + (playing ? max(0, serverNow − at) : 0), capped at durationMs if known
  serverNow   = System.currentTimeMillis() + offset
  ```

- **`rev`.** Every change to the stored playback gets the next revision number: each accepted report, each transfer, and the automatic pause when the active device vanishes. Remotes compare revisions to notice changes they missed, and catch up by reconnecting.
- **Saving.** The playback is saved to the database a few seconds after each change. If the live copy is lost, it's brought back from there, paused, at volume 1.

### Link types

```ts
type DeviceKind = "phone" | "tablet" | "computer";

interface LinkDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  until: number;              // server time it drops off the list unless it checks in again
}

interface LinkState {
  queue: QueueSong[];         // up to 500
  unshuffled?: QueueSong[] | null; // the order to go back to when shuffle turns off; null when not shuffled
  index: number;              // current song in queue; -1 when nothing is loaded
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  playing: boolean;
  buffering: boolean;
  error?: string | null;      // a message to show, e.g. "Couldn't play Midnight City."
  volume: number;             // 0–1
  muted: boolean;
  positionMs: number;         // playhead at time `at`
  durationMs?: number | null;
  at: number;                 // server time positionMs was true
  rev?: number;
}

// A queue entry is a Song (see Types) as the player holds it. The server stores
// whatever it's given; keep to this shape so the web app can show your queue and you can show its queue.
type QueueSong = Song & { autoplay?: true };  // autoplay: added by autoplay, not by the person

// What the active device reports: LinkState minus at/rev, with queue and unshuffled
// only when they changed.
type LinkPatch = Omit<LinkState, "queue" | "unshuffled" | "at" | "rev"> & { queue?: QueueSong[]; unshuffled?: QueueSong[] | null };

type LinkCommand =
  | { type: "play"; songs: Song[]; startIndex: number; shuffle?: boolean } // replace the queue and play
  | { type: "playNext"; song: Song }
  | { type: "addToQueue"; song: Song }
  | { type: "removeFromQueue"; index: number; songId: string }
  | { type: "jumpTo"; index: number; songId: string }
  | { type: "moveInQueue"; from: number; to: number; songId: string }
  | { type: "toggle" }                    // play/pause
  | { type: "next" }
  | { type: "prev" }
  | { type: "cycleRepeat" }               // off → all → one → off
  | { type: "seek"; seconds: number }     // absolute position, in seconds
  | { type: "setShuffle"; on: boolean }
  | { type: "setVolume"; volume: number } // 0–1 (the web app also unmutes)
  | { type: "setMuted"; muted: boolean };
```

Queue commands carry both an index and the `songId` it pointed at, because the queue may have moved since the remote looked. The active device should use `index` if `queue[index].id == songId`. Otherwise it should use the position of `songId` nearest to `index`, and ignore the command if that song isn't in the queue.

### `GET /api/link`: event stream

| Query param | Required | Rule |
|---|---|---|
| `device` | yes | `^[A-Za-z0-9_-]{8,64}$` (a UUID string fits) |
| `name` | yes | Trimmed, max 60, not blank. Shown to the person's other devices (for example "Pixel 8"). Let people rename it. |
| `kind` | yes | `phone`, `tablet` or `computer` |

**Errors before the stream starts:** `400 {"error":"Bad device"}`, `401`, `403` (Link off).

**Response:** `200`, `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`. The stream opens with `retry: 2000`. After that, every event is a single `data:` line of JSON followed by a blank line. There's no `event:` field, so read `type` from the JSON. There's no `id:` field either, so `Last-Event-ID` resuming isn't supported. If the server's link store has a problem, you may also see comment lines (`: still here`), which you can ignore. If the server can't register the device, it closes the stream at once: reconnect with backoff.

The token is checked only when the stream opens. An open stream keeps going after the token expires, so refresh the token before you reconnect.

#### Events

**`hello`** is the first event on every connection. It tells you everything you need to know.

```json
{ "type": "hello", "self": "4c7d2b1e-9a0f-4e3b-8d6c-1f2a3b4c5d6e", "now": 1763285412345,
  "devices": [
    { "id": "4c7d2b1e-9a0f-4e3b-8d6c-1f2a3b4c5d6e", "name": "Pixel 8", "kind": "phone", "until": 1763285457345 },
    { "id": "b0e1f2a3-...", "name": "Chrome on Mac", "kind": "computer", "until": 1763285449000 }
  ],
  "active": "b0e1f2a3-...",
  "state": { "queue": [ /* QueueSong */ ], "unshuffled": null, "index": 3, "shuffle": false, "repeat": "off",
             "playing": true, "buffering": false, "error": null, "volume": 0.8, "muted": false,
             "positionMs": 61234, "durationMs": 243000, "at": 1763285410012, "rev": 1182 } }
```

`devices` includes you. `active` is the device playing (only if it's online), else `null`. `state` is the full [`LinkState`](#link-types), or `null` if the account has never played anything.

**`devices`** is sent when the device list or the active device changes: someone connects, someone drops off, or playback moves.

```json
{ "type": "devices", "now": 1763285500000, "devices": [ /* LinkDevice */ ], "active": "4c7d2b1e-..." }
```

**`ping`** comes every 15 s. It proves the stream is alive, and carries enough for you to notice anything you missed.

```json
{ "type": "ping", "now": 1763285515000, "devices": [ /* LinkDevice */ ], "active": "4c7d2b1e-...", "rev": 1190 }
```

**`state`** reports that the playback changed. It's sent to every device except the one that reported the change. After a transfer, it goes to every device except the one receiving playback, which gets `transfer` instead.

```json
{ "type": "state", "from": "b0e1f2a3-...",
  "state": { "index": 4, "shuffle": false, "repeat": "off", "playing": true, "buffering": false, "error": null,
             "volume": 0.8, "muted": false, "positionMs": 0, "durationMs": 198000, "at": 1763285520480, "rev": 1191 } }
```

`state` is a **partial** `LinkState`. Merge it into what you have: fields present replace yours. `queue` and `unshuffled` are only present when they changed, so keep your own copies otherwise. After a transfer, or when the active device vanished, `state` is complete. In the vanished case `from` is the device that vanished and `playing` is `false`. If you have no state yet and the event has no `queue`, you can't use it: wait for one that has a queue, or reconnect.

**`command`** is a control from a remote. Only the active device receives these. The command is a [`LinkCommand`](#link-types).

```json
{ "type": "command", "command": { "type": "jumpTo", "index": 7, "songId": "3f6c1e0a-8b7d-4c2e-9a51-2d0f7b8e4c11" } }
```

The server passes commands on **without checking them** beyond `type` being a string. Validate them before acting on them.

**`transfer`** means playback has moved to this device: carry on from here.

```json
{ "type": "transfer", "state": { /* full LinkState, position brought up to date, or null */ }, "play": true }
```

`play` tells you whether it was playing at the moment it moved. You don't receive this event when you moved playback to yourself.

**`release`** means playback has moved away from this device: stop playing.

```json
{ "type": "release" }
```

#### Keeping the stream healthy

- **Silence.** Treat 40 s without any event as a dead stream (pings come every 15 s), even if the socket looks open. Close it and reconnect. Also reconnect at once when the app comes back to the foreground or the network returns, if the stream has been quiet for 20 s or more.
- **Reconnecting.** Retry with backoff after an error. The web app waits 1 s, 2 s, 5 s, 10 s, then 30 s between attempts, and resets after the first event. Each new connection starts with a fresh `hello`, which replaces everything you knew. **Reconnecting is how you resync.**
- **Missed changes** (for remotes; the active device is the one making the changes, so it skips this):
  - A `state` event whose `rev` is more than one past the last rev you saw (when you've seen one) means you missed a change. Your copy of the queue can't be trusted, so reconnect.
  - A `ping` whose `rev` is ahead of yours may just mean a `state` event is still on its way. Wait about 3 s, and if you're still behind, reconnect.
  - Take your rev from `hello.state.rev`, from each `state` and `transfer` event, and from the `rev` in your own successful `POST`s. Always keep the highest.
- **Expired devices.** Hide devices whose `until` is earlier than `System.currentTimeMillis() + offset`, even between events.
- **One stream per device id.** Two streams with the same id confuse delivery.

**On Android:** OkHttp's `okhttp-sse` (`EventSources.createFactory(client)`) sends normal request headers, so add `Authorization: Bearer …` to the `Request`. Two things to watch. **OkHttp's default 10 s read timeout is shorter than the 15 s ping interval, so it will keep killing the stream.** Use a client with `readTimeout(0)` (or at least 60 s) for the stream and rely on the 40 s silence check above. And okhttp-sse doesn't reconnect by itself, so do it in `onFailure` and `onClosed`. While you're playing, keep the stream up from the foreground media service. If it drops, the server decides the active device is gone and pauses the account's playback for everyone: 8 s after a stream it sees closing, or within about a minute for one that silently died (45 s without a check-in, noticed at the next ping).

### `POST /api/link`

Every body has an `action` and your `device` id (the same id as your stream).

**Errors for all actions:** `400 {"error":"Bad JSON"}`, `400 {"error":"Bad device"}`, `400 {"error":"Unknown action"}`, `401`, `403` (Link off).

#### `action: "state"`: report your playback

Only the active device sends this, or a device that's taking over.

```json
{ "action": "state", "device": "4c7d2b1e-...", "seq": 1763285520481, "claim": false,
  "patch": { "index": 4, "shuffle": false, "repeat": "off", "playing": true, "buffering": false, "error": null,
             "volume": 0.8, "muted": false, "positionMs": 0, "durationMs": 198000,
             "queue": [ /* only when it changed */ ] } }
```

| Field | Type | Rule |
|---|---|---|
| `seq` | number | **Must be greater than every `seq` this device id has sent before.** The server remembers the last one for 7 days, across reconnects and app restarts. Use `seq = max(lastSeq + 1, System.currentTimeMillis())`. |
| `claim` | boolean | `true` when you're not the active device and are taking playback over (see below). |
| `patch.index` | integer | Required. |
| `patch.playing` | boolean | Required. |
| `patch.positionMs` | number | Required. The current playhead. Negative values become 0. |
| `patch.queue` | array | At most 500 entries. Send it only when the queue changed (see below). |
| `patch.unshuffled` | array or null | At most 500 entries. Same rule as `queue`. |
| `patch.shuffle`, `buffering`, `muted` | boolean | Converted to a boolean (`!!value`); if it's missing, it's `false`. |
| `patch.repeat` | string | Anything other than `"all"` or `"one"` is read as `"off"`. |
| `patch.volume` | number | Clamped to 0–1. **If it's missing or not a number it becomes 0**, so always send it. |
| `patch.error` | string or null | Cut to 200 characters. Anything else becomes `null`. |
| `patch.durationMs` | number or null | Anything else becomes `null`. |

A body that breaks the required rules gets `400 {"error":"Bad state"}`.

**Queue rule.** The server keeps the last queue it was sent. If you leave `queue` (or `unshuffled`) out, the stored one stays. If nothing is stored yet, the queue is `[]`. So:
- Include `queue` and `unshuffled` whenever they differ from what you last had accepted.
- Include them again on the first report after any result other than `ok` or `stale`.
- Include them when you take over, unless you just loaded that same queue from the server.

**Who gets to report.** The server takes reports from the active device. A report from another device is accepted, and that device becomes active, only in one of two cases:
- nobody else that's online is active (no active device, or it went offline). In that case even a paused report takes over, with or without `claim`.
- `claim` is `true` **and** `patch.playing` is `true`. The device that was active then gets `release`.

A device that wants playback while paused should use `transfer` to itself instead. Every takeover also sends `devices` to everyone.

**Results:**

| Status and body | Meaning | What to do |
|---|---|---|
| `200 {"result":"ok","rev":1191}` | Stored and sent to the other devices. | Note `rev`. You're the active device. |
| `200 {"result":"stale"}` | `seq` wasn't higher than one already received from this device, so it was dropped. Nothing changed. | Nothing (a newer report won). If the dropped report carried a queue change, include the queue in the next one. Sending one report at a time avoids this. |
| `200 {"result":"not-playing"}` | Another online device is active, and this wasn't a takeover (`claim` with `playing: true`). Ignored. | You're a remote now. Stop playing locally if you still are (you probably missed a `release`), reconnect the stream to resync, and resend the queue if you report again. |
| `409 {"result":"gone"}` | Your device isn't online as far as the server knows: no open stream, or it expired. Ignored. | Reconnect the stream, then report again in full, queue included. |

Note that `stale` and `not-playing` come back as `200`. Check `result`, not just the status.

#### `action: "command"`: control the active device

```json
{ "action": "command", "device": "<your id>", "command": { "type": "seek", "seconds": 95.5 } }
```

**Response:** `200 {"sent": true}`. You get `409 {"sent": false}` when no active device is online, or when you are the active device (apply the command yourself instead). `400 {"error":"Bad command"}` if `command.type` isn't a string.

`sent: true` means only that the command was passed on. The result shows up as the next `state` event. The web app updates its own view straight away (for example it moves the playhead on `seek` or flips play/pause on `toggle`), then lets the next `state` event correct it.

#### `action: "transfer"`: move playback

```json
{ "action": "transfer", "device": "<your id>", "to": "<target device id>" }
```

`to` can be another device or yourself.

**Response:** `200 {"moved": true}`, or `409 {"moved": false}` if `to` isn't online. `400 {"error":"Bad device"}` for a malformed `to`.

What the server does, in order:
1. Makes `to` the active device.
2. Brings the stored `positionMs` and `at` up to now. `playing` keeps its value.
3. Sends `release` to the device that was active (if it isn't `to`).
4. Sends `transfer` to `to`, unless `to` is you.
5. Sends `state` (complete) to everyone except `to`, then `devices` to everyone.

### What a client does

#### Every device

1. Generate a device id once per install and keep it. Pick a name (for example `Build.MODEL`, renameable) and a kind.
2. When Link is on (`Me.server.features.link`), keep the event stream open while the app runs, and keep it open while playing in the background.
3. On `hello`, replace everything you knew: devices, active, state, rev, offset. Then:
   - `active` is you: you're still the active device (you reconnected within the grace period). Carry on reporting.
   - you're playing audio right now (for example the stream dropped mid-song): report with `claim: true`, including the queue, to keep playing here. This is what the web app does, even if another device took over while you were away.
   - `active` is another device: be its remote.
   - `active` is `null` and `state` has a queue: load that queue at `index`, at the computed position, **paused**, and don't report it. Nothing has changed, you've just caught up.
4. Keep `offset` up to date from every `hello`, `devices` and `ping`, and filter devices by `until`.

#### Being the playing device

1. **Report** with `action: "state"` on every change (play/pause, song change, queue edit, shuffle, repeat, volume, mute, buffering, error), waiting about 150 ms to merge bursts. Also report right after a seek, and every 5 s while playing, so remotes' playheads stay true. Send one report at a time, with an increasing `seq`, and include the queue only when it changed (see the queue rule). Set `claim: true` whenever you don't think you're active, for example when the person starts playback here while another device was active.
2. **Act on `command` events** as if the person had tapped the control on this device, finding queue songs by `songId`. Your next report shows the result to everyone.
3. **On `release`, stop** (pause). You're now a remote of the new active device, whose `state` and `devices` events follow.
4. **To move playback elsewhere**, report your exact state first (so the position is right), then `transfer` with `to` set to the other device. You'll get `release` back.
5. **Act on results:** see the table above. In short, `not-playing` and `gone` mean reconnect and resend in full.
6. If the queue runs low and autoplay is on, the playing device fetches more with [`POST /api/autoplay`](#post-apiautoplay). Remotes don't.
7. Keep reporting [plays](#post-apiplays) and [listens](#post-apilistens) as usual. Only the playing device does.

#### Being a remote

1. **Show the state** from `hello` and the `state` events you've merged in. Work out the playhead from `positionMs`, `at`, `playing` and `offset` (see the formula above), and tick it locally. Don't play audio.
2. **Controls send commands** (`action: "command"`). Update your own view straight away, then let the next `state` event confirm or correct it. On `409 {"sent": false}`, say that the playing device can't be reached. For `removeFromQueue`, `jumpTo` and `moveInQueue`, send the index and the song id you saw there. The web app doesn't let remotes remove the current song or move songs at or before it.
3. **Watch `rev`** and reconnect when you've missed a change (see [Keeping the stream healthy](#keeping-the-stream-healthy)).
4. **If the active device disappears** (a `ping` or `devices` event shows `active: null` while you were a remote), take the last state you had, load it paused at the computed position, and don't report it. The server has already paused it and told everyone.
5. **To play here instead**, start playing locally from the state you have (queue, index, computed position). Then `transfer` with `to` set to your own id. You won't get a `transfer` event. Start reporting as the playing device; your first report doesn't need `claim`, since you're active now.

#### Receiving playback (`transfer` event)

Load `state.queue` at `state.index`, seek to the position computed from `state`, and start playing if `play` is true. If `state` is `null` there's nothing to play. Then report as the playing device.
