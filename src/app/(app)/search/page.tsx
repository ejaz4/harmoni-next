"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { usePlayer } from "@/components/player/player";
import { useSettings } from "@/components/providers/settings";
import { ArtistLinks, SongList } from "@/components/song/song-list";
import { Artwork, EmptyState, PlayButton, Section, ui } from "@/components/ui";
import { useArtworkTheme } from "@/lib/artwork-theme";
import type { ProviderStatus, SearchEvent } from "@/server/search/service";
import type { SongResult } from "@/server/library/song-view";
import styles from "../pages.module.css";

export default function SearchPage() {
  return (
    <Suspense>
      <Search />
    </Suspense>
  );
}

interface SearchState {
  query: string;
  providers: { prefix: string; name: string; status?: ProviderStatus }[];
  results: SongResult[];
  done: boolean;
  error?: string;
}

function Search() {
  const query = useSearchParams().get("q")?.trim() ?? "";
  const [state, setState] = useState<SearchState>();
  const { settings } = useSettings();

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/search?stream=1&q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (res.status === 401) return void (window.location.href = new URL("/login", window.location.origin).href);
        if (!res.ok || !res.body) throw new Error(`Search failed (${res.status})`);
        for await (const event of readEvents(res.body)) {
          if (event.type === "start") setState({ query, providers: event.providers, results: [], done: false });
          else if (event.type === "provider")
            setState((s) => s && { ...s, results: event.results, providers: s.providers.map((p) => (p.prefix === event.status.prefix ? { ...p, status: event.status } : p)) });
          else if (event.type === "done") setState((s) => s && { ...s, done: true });
        }
      } catch (err) {
        if (!controller.signal.aborted) setState({ query, providers: [], results: [], done: true, error: String(err) });
      }
    })();
    return () => controller.abort();
  }, [query]);

  if (!query) {
    return (
      <>
        <h1 className={styles.pageTitle}>Search</h1>
        <p className={styles.pageSubtitle}>What are you in the mood for?</p>
        <EmptyState title="Type in the search bar up top" body="Songs, artists, lyrics you half remember. Harmoni checks every source at once." />
      </>
    );
  }

  const current = state?.query === query ? state : undefined;
  const results = current?.results ?? [];
  const searching = !current?.done;
  const artists = uniqueArtists(results);

  return (
    <>
      <h1 className={styles.pageTitle}>{searching && !results.length ? "Searching…" : `Results for “${query}”`}</h1>
      {settings.developerMode && current && (
        <div className={styles.providers} aria-label="Sources">
          {current.providers.map((p) => (
            <span key={p.prefix} className={styles.provider} title={p.status?.error}>
              <span className={`${styles.dot} ${!p.status ? styles.dotPending : p.status.ok ? styles.dotOk : styles.dotFail}`} />
              {p.name}
              {p.status && ` · ${p.status.ok ? p.status.count : "failed"} · ${p.status.ms}ms`}
            </span>
          ))}
        </div>
      )}

      {current?.error && <EmptyState title="Search hit a snag" body="Something went wrong talking to the server. Give it another go in a moment." />}

      {!searching && !results.length && !current?.error && (
        <EmptyState title="Nothing turned up" body={`No sources had anything for “${query}”. Check the spelling, or try the artist's name on its own.`} />
      )}

      {results.length > 0 && (
        <div className={styles.searchTop}>
          <div>
            <h2 className={ui.sectionTitle} style={{ marginBottom: 16 }}>
              Top result
            </h2>
            <TopResult song={results[0]} results={results} />
          </div>
          <div>
            <h2 className={ui.sectionTitle} style={{ marginBottom: 8 }}>
              Songs
            </h2>
            <SongList songs={results.slice(0, 5)} showAlbum={false} />
          </div>
        </div>
      )}

      {artists.length > 0 && (
        <Section title="Artists">
          <div className={styles.artistRow}>
            {artists.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className={styles.artistChip}>
                <Artwork src={a.artworkUrl} size={132} radius="xl" />
                <span className={styles.artistName}>{a.name}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {results.length > 5 && (
        <Section title="More songs">
          <SongList songs={results.slice(5)} />
        </Section>
      )}
    </>
  );
}

function TopResult({ song, results }: { song: SongResult; results: SongResult[] }) {
  const player = usePlayer();
  const theme = useArtworkTheme(song.id);
  const isCurrent = player.current?.id === song.id;
  const style = { "--hero-color": theme?.color, "--hero-ink": theme?.ink, "--hero-ink-muted": theme?.inkMuted } as React.CSSProperties;
  return (
    <div className={styles.topResult} style={style} onClick={() => (isCurrent ? player.toggle() : player.play(results, 0))}>
      <Artwork src={song.artworkUrl} size={112} radius="lg" />
      <div>
        <div className={styles.topResultTitle}>{song.title}</div>
        <div className={styles.topResultMeta}>
          Song · <ArtistLinks artists={song.artists} />
        </div>
      </div>
      <PlayButton
        className={styles.heroPlay}
        playing={isCurrent && player.playing}
        onClick={(e) => {
          e.stopPropagation();
          if (isCurrent) player.toggle();
          else player.play(results, 0);
        }}
      />
    </div>
  );
}

// Artists that appear in the results, in order, with a cover to stand in for a photo.
function uniqueArtists(results: SongResult[]) {
  const seen = new Map<string, { id: string; name: string; artworkUrl?: string }>();
  for (const song of results) {
    for (const a of song.artists) {
      if (a.id && !seen.has(a.id)) seen.set(a.id, { id: a.id, name: a.name, artworkUrl: song.artworkUrl });
    }
  }
  return [...seen.values()].slice(0, 10);
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SearchEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
}
