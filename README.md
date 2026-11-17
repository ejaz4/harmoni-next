# Harmoni Next

A self-hosted music server that treats streaming services as interchangeable,
unreliable sources and owns the library itself. Songs, artists and albums are
canonical records; each provider's copy is a linked source (`ytm:abc`,
`deezer:123`). Search fans out to every provider and merges results with a
local matcher; playback falls back across sources and caches what it plays.

## Development

Requires [Bun](https://bun.sh) and Docker. Docker Compose runs Postgres and a
yt-dlp sidecar (`services/ytdlp`) that resolves YouTube audio; rebuild it
(`docker compose -p harmoni build ytdlp`) to pick up yt-dlp fixes.

```sh
bun install
cp .env.example .env   # then set BETTER_AUTH_SECRET (openssl rand -base64 32) and URLs
bun run db:up          # Postgres on 127.0.0.1:5433, yt-dlp sidecar on 127.0.0.1:3101
bun run db:migrate
bun run dev            # http://<host>:3100
bun test
```

The first account to sign up becomes the admin. Everyone after that needs a
one-time invite link, created under Settings. Accounts are username + password.

Search providers: YouTube Music, Deezer and iTunes (`ITUNES_COUNTRY`) need no keys. MusicBrainz is
attach-only: it adds ISRCs to songs the others find, but never adds results of its own.
TIDAL search is enabled when `TIDAL_CLIENT_ID` and `TIDAL_CLIENT_SECRET` are set (free app at
developer.tidal.com, no subscription). Spotify search is enabled when `SPOTIFY_CLIENT_ID` and
`SPOTIFY_CLIENT_SECRET` are set (needs a Premium account).

## Apps and the API

Apps sign in with OAuth 2.0 (authorization code + PKCE, dynamic client registration) and get the
same API as the web app, minus server settings. [docs/api/README.md](docs/api/README.md) is the
guide for app developers; [docs/api/reference.md](docs/api/reference.md) documents every endpoint,
including the Harmoni Link protocol. Every server shows both at `/developers` (public, no account
needed), rendered by `src/server/docs/` with that server's address in the examples.

## Production

`docker compose -p harmoni up -d --build` builds and runs everything: Postgres, the yt-dlp sidecar,
a one-shot `migrate` job (applies Prisma migrations), and `harmoni-web` (the Next.js standalone
server on port 3000). `harmoni-web` reads secrets from `.env` and joins the external `internet`
network, where Caddy proxies `music.ceccun.com` to `harmoni-web:3000` (with `flush_interval -1` so
streamed search and audio aren't buffered). Set `PUBLIC_URL` if it's served somewhere else.

To deploy changes: `docker compose -p harmoni up -d --build web` (add `migrate` when the schema changed).

## Layout

- `src/app/(app)/` — the app: Home, Search, Liked, Recently Played, playlists, albums, artists, Settings
- `src/app/(auth)/` — sign in and sign up
- `src/app/developers/` — the API docs page, built from `docs/api` by `src/server/docs/`
- `src/app/debug/` — raw search results with every source (linked from the sidebar in developer mode)
- `src/app/api/` — JSON API; every route checks the session or an app's access token
- `docs/api/` — the API guide and reference, for app developers
- `src/components/` — player (one audio element for the app), shell, song lists, UI primitives
- `src/server/auth.ts` — accounts (better-auth), invites
- `src/server/oauth/` — OAuth for apps: registration, consent, tokens; `src/server/session.ts` checks cookies and tokens
- `src/server/library/` — likes, history, playlists, catalogue pages
- `src/server/providers/` — provider plugins and registry
- `src/server/matching/` — normalisation and the layered matcher
- `src/server/search/` — search fan-out, grouping, background persistence
- `src/server/lyrics/` — lyrics service (LRCLIB → YouTube Music), LRC parsing, romanisation, cache
- `src/server/playback/` — resolver (cache → ranked sources → crossmatch), audio cache, provider health
- `services/ytdlp/` — yt-dlp HTTP sidecar

## Credits

Icons from [Basil](https://www.figma.com/community/file/931906394678748246) by Craftwork and
[Font Awesome 6](https://github.com/FortAwesome/Font-Awesome) by Dave Gandy, both
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Run `bun run icons` after changing the
set in `scripts/build-icons.ts`.
