"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { usePlayer } from "@/components/player/player";
import { useSettings } from "@/components/providers/settings";
import { ArtistLinks, SongList } from "@/components/song/song-list";
import { Artwork, EmptyState, PlayButton, Section, ui } from "@/components/ui";
import { useArtworkTheme, useImageTheme } from "@/lib/artwork-theme";
import { pickTopArtist } from "@/lib/search-rank";
import { readEvents } from "@/lib/search-stream";
import { usePlaySpice } from "@/components/spice/spice-card";
import { SpiceArt } from "@/components/spice/spice-art";
import type { SpiceCard } from "@/server/discovery/spice";
import type { ProviderStatus } from "@/server/search/service";
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
  spice?: SpiceCard;
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
          else if (event.type === "spice") setState((s) => s && { ...s, spice: event.spice });
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
  // Searching an artist's name (even misspelt) means you want the artist,
  // not their latest single.
  const topArtist = pickTopArtist(query, artists, results[0]);

  return (
    <>
      {/* The query is already in the search field; the heading is for screen readers. */}
      <h1 className="visually-hidden">Results for “{query}”</h1>
      {searching && !results.length && !current?.error && <SearchSkeleton />}
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

      {current?.spice && <SpiceResult spice={current.spice} />}

      {results.length > 0 && (
        <div className={styles.searchTop}>
          <div className={styles.searchColumn}>
            <h2 className={ui.sectionTitle}>Top result</h2>
            {topArtist ? <ArtistTopResult artist={topArtist} results={results} /> : <TopResult song={results[0]} />}
          </div>
          <div className={styles.searchColumn}>
            <h2 className={ui.sectionTitle}>Songs</h2>
            <SongList songs={results.slice(0, 5)} showAlbum={false} single />
          </div>
        </div>
      )}

      {artists.length > 0 && (
        <Section title="Artists">
          <div className={styles.artistRow}>
            {artists.map((a) => (
              <Link key={a.id} href={`/artist/${a.id}`} className={styles.artistChip}>
                <Artwork src={artistImage(a.id)} fallbackSrc={a.artworkUrl} alt="" className={styles.artistPhoto} />
                <span className={styles.artistName}>{a.name}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {results.length > 5 && (
        <Section title="More songs">
          <SongList songs={results.slice(5)} single />
        </Section>
      )}
    </>
  );
}

// A genre or mood search gets its Spice: the genre, picked for you, fresh daily.
function SpiceResult({ spice }: { spice: SpiceCard }) {
  const { play, loading } = usePlaySpice();
  return (
    <Link href={`/spice/${spice.id}`} className={styles.spiceResult}>
      <div className={styles.spiceResultArt}>
        <SpiceArt name={spice.name} covers={spice.covers} label={false} />
      </div>
      <div className={styles.spiceResultBody}>
        <span className={styles.spiceResultKicker}>Spice</span>
        <span className={styles.spiceResultTitle}>{spice.name}</span>
        <span className={styles.spiceResultText}>{spice.name} picked for you, different every day</span>
      </div>
      <PlayButton
        className={styles.heroPlay}
        playing={loading}
        label={`Play the ${spice.name} Spice`}
        onClick={(e) => {
          e.preventDefault();
          void play(spice.id);
        }}
      />
    </Link>
  );
}

function TopResult({ song }: { song: SongResult }) {
  const player = usePlayer();
  const theme = useArtworkTheme(song.id);
  const isCurrent = player.current?.id === song.id;
  const style = { "--hero-color": theme?.color, "--hero-ink": theme?.ink, "--hero-ink-muted": theme?.inkMuted } as React.CSSProperties;
  return (
    <div className={styles.topResult} style={style} onClick={() => (isCurrent ? player.toggle() : player.play([song], 0))}>
      <Artwork src={song.artworkUrl} size={136} radius="lg" />
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
          else player.play([song], 0);
        }}
      />
    </div>
  );
}

// The shape of the results, shimmering, until the first source answers.
function SearchSkeleton() {
  return (
    <div aria-busy="true" aria-label="Searching">
      <div className={styles.searchTop}>
        <div className={styles.searchColumn}>
          <div className={ui.skeleton} style={{ height: 26, width: 120 }} />
          <div className={`${ui.skeleton} ${styles.topResultSkeleton}`} />
        </div>
        <div className={styles.searchColumn}>
          <div className={ui.skeleton} style={{ height: 26, width: 90 }} />
          <div>
            {[46, 62, 38, 54, 44].map((w, i) => (
              <div key={i} className={styles.rowSkeleton}>
                <div className={ui.skeleton} style={{ width: 44, height: 44 }} />
                <div className={styles.rowSkeletonText}>
                  <div className={ui.skeleton} style={{ height: 14, width: `${w}%` }} />
                  <div className={ui.skeleton} style={{ height: 12, width: `${w * 0.6}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={ui.section}>
        <div className={ui.skeleton} style={{ height: 26, width: 100, marginBottom: 16 }} />
        <div className={styles.artistRow}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={styles.artistChip}>
              <div className={`${ui.skeleton} ${styles.artistPhoto}`} />
              <div className={ui.skeleton} style={{ height: 12, width: "60%" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtistTopResult({ artist, results }: { artist: SearchArtist; results: SongResult[] }) {
  const player = usePlayer();
  const photoTheme = useImageTheme(artistImage(artist.id));
  const coverTheme = useArtworkTheme(artist.songId);
  const theme = photoTheme ?? coverTheme;
  const theirs = results.filter((s) => s.artists.some((a) => a.id === artist.id));
  const isTheirs = theirs.some((s) => s.id === player.current?.id);
  const style = { "--hero-color": theme?.color, "--hero-ink": theme?.ink, "--hero-ink-muted": theme?.inkMuted } as React.CSSProperties;
  return (
    <Link href={`/artist/${artist.id}`} className={styles.topResult} style={style}>
      <Artwork src={artistImage(artist.id)} fallbackSrc={artist.artworkUrl} alt="" size={136} radius="xl" className={styles.topResultPhoto} />
      <div>
        <div className={styles.topResultTitle}>{artist.name}</div>
        <div className={styles.topResultMeta}>Artist</div>
      </div>
      <PlayButton
        className={styles.heroPlay}
        playing={isTheirs && player.playing}
        label={isTheirs && player.playing ? "Pause" : `Play ${artist.name}`}
        onClick={(e) => {
          e.preventDefault();
          if (isTheirs) player.toggle();
          else player.play(theirs, 0);
        }}
      />
    </Link>
  );
}

const artistImage = (id: string) => `/api/artists/${id}/image`;

interface SearchArtist {
  id: string;
  name: string;
  artworkUrl?: string; // a cover of theirs, for when there's no photo
  songId: string;
  songs: number;
}

// Artists that appear in the results, in order, with a cover to stand in for a photo.
function uniqueArtists(results: SongResult[]): SearchArtist[] {
  const seen = new Map<string, SearchArtist>();
  for (const song of results) {
    for (const a of song.artists) {
      if (!a.id) continue;
      const known = seen.get(a.id);
      if (known) known.songs++;
      else seen.set(a.id, { id: a.id, name: a.name, artworkUrl: song.artworkUrl, songId: song.id, songs: 1 });
    }
  }
  return [...seen.values()].slice(0, 10);
}
