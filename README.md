# Harmoni Next

A self-hosted music server that treats streaming services as interchangeable,
unreliable sources and owns the library itself. Songs, artists and albums are
canonical records; each provider's copy is a linked source (`ytm:abc`,
`deezer:123`). Search fans out to every provider and merges results with a
local matcher.

## Development

Requires [Bun](https://bun.sh) and Docker. Docker Compose runs Postgres and a
yt-dlp sidecar (`services/ytdlp`) that resolves YouTube audio; rebuild it
(`docker compose -p harmoni build ytdlp`) to pick up yt-dlp fixes.

```sh
bun install
cp .env.example .env
bun run db:up        # Postgres on 127.0.0.1:5433, yt-dlp sidecar on 127.0.0.1:3101
bun run db:migrate
bun run dev          # http://<host>:3100
bun test
```

Search providers: YouTube Music, Deezer and iTunes (`ITUNES_COUNTRY`) need no keys. MusicBrainz is
attach-only: it adds ISRCs to songs the others find, but never adds results of its own.
TIDAL search is enabled when `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` are set (free app at
developer.tidal.com, no subscription). Spotify search is enabled when `SPOTIFY_CLIENT_ID` and
`SPOTIFY_CLIENT_SECRET` are set (needs a Premium account).

## Layout

- `src/server/providers/` — provider plugins and registry
- `src/server/matching/` — normalisation and the layered matcher
- `src/server/search/` — search fan-out, grouping, background persistence
- `src/server/lyrics/` — lyrics service (LRCLIB → YouTube Music), LRC parsing, romanisation, cache
- `src/server/playback/` — resolver (cache → ranked sources → crossmatch), audio cache, provider health
- `services/ytdlp/` — yt-dlp HTTP sidecar
- `src/app/` — Next.js app (currently a bare search + play test page)
