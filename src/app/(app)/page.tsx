"use client";

import { useSyncExternalStore } from "react";
import { usePlayer } from "@/components/player/player";
import { useLibrary } from "@/components/providers/library";
import { useUser } from "@/components/providers/user";
import { CardLink, SongCard } from "@/components/song/song-card";
import { SongList } from "@/components/song/song-list";
import { Artwork, EmptyState, PlayButton, Section, ui } from "@/components/ui";
import { useArtworkTheme } from "@/lib/artwork-theme";
import { greeting, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { PlaylistSummary } from "@/server/library/service";
import type { SongResult } from "@/server/library/song-view";
import styles from "./pages.module.css";

const noSubscribe = () => () => {};

interface HomeData {
  recent: SongResult[];
  liked: SongResult[];
  playlists: PlaylistSummary[];
}

export default function HomePage() {
  const library = useLibrary();
  const { data } = useApi<HomeData>("/api/home", library.version);
  const user = useUser();
  // Uses the local clock, so the server renders a neutral "Hello".
  const hello = useSyncExternalStore(noSubscribe, greeting, () => "Hello");
  const name = user?.name?.split(" ")[0];

  if (!data) return <HomeSkeleton />;
  const fresh = !data.recent.length && !data.liked.length;

  return (
    <>
      {fresh ? <WelcomeHero hello={hello} name={name} /> : <ResumeHero hello={hello} name={name} recent={data.recent} />}

      {data.recent.length > 0 && (
        <Section title="Jump back in" link={{ href: "/recent", label: "See all" }}>
          <div className={ui.cardGrid}>
            {data.recent.slice(0, 6).map((song, i) => (
              <SongCard key={song.id} song={song} list={data.recent} index={i} />
            ))}
          </div>
        </Section>
      )}

      {data.liked.length > 0 && (
        <Section title="Songs you love" link={{ href: "/liked", label: "See all" }}>
          <SongList songs={data.liked.slice(0, 6)} />
        </Section>
      )}

      {data.playlists.length > 0 && (
        <Section title="Your playlists">
          <div className={ui.cardGrid}>
            {data.playlists.map((p) => (
              <CardLink key={p.id} href={`/playlist/${p.id}`} artwork={p.artworks[0]} title={p.name} subtitle={plural(p.count, "song")} />
            ))}
          </div>
        </Section>
      )}

      {fresh && (
        <Section title="How Harmoni works">
          <EmptyState
            title="One search, every source"
            body="Search once and Harmoni asks YouTube Music, Deezer, iTunes and TIDAL together, then merges the results so each song shows up once. If one source goes down, your music keeps playing from another."
          />
        </Section>
      )}
    </>
  );
}

function ResumeHero({ hello, name, recent }: { hello: string; name?: string; recent: SongResult[] }) {
  const player = usePlayer();
  const last = recent[0];
  const theme = useArtworkTheme(last.id);
  const style = { "--hero-color": theme?.color, "--hero-ink": theme?.ink, "--hero-ink-muted": theme?.inkMuted } as React.CSSProperties;
  const others = [...new Set(recent.slice(1).flatMap((s) => s.artists.map((a) => a.name)))].slice(0, 2);

  return (
    <section className={styles.hero} style={style}>
      {last.artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.heroArt} src={`/api/songs/${last.id}/artwork`} alt="" />
      )}
      <div className={styles.heroBody}>
        <span className={styles.heroEyebrow}>
          {hello}
          {name ? `, ${name}` : ""}
        </span>
        <h1 className={styles.heroTitle}>Pick up where you left off</h1>
        <p className={styles.heroText}>
          You were listening to {last.title} by {last.artists[0]?.name}
          {others.length ? `, with a bit of ${others.join(" and ")} before that.` : "."}
        </p>
        <div className={styles.heroActions}>
          <PlayButton className={styles.heroPlay} onClick={() => player.play(recent, 0)} label="Play your recent songs" />
          <span className={styles.heroMeta}>{plural(recent.length, "song")}</span>
        </div>
      </div>
    </section>
  );
}

function WelcomeHero({ hello, name }: { hello: string; name?: string }) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroBody}>
        <span className={styles.heroEyebrow}>
          {hello}
          {name ? `, ${name}` : ""}
        </span>
        <h1 className={styles.heroTitle}>Let&apos;s find your sound</h1>
        <p className={styles.heroText}>Search for a song or an artist you love. Press / to jump to search from anywhere.</p>
        <div className={styles.heroActions}>
          <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={() => document.getElementById("global-search")?.focus()}>
            Start searching
          </button>
        </div>
      </div>
    </section>
  );
}

function HomeSkeleton() {
  return (
    <>
      <div className={`${ui.skeleton}`} style={{ height: 320, borderRadius: "var(--radius-xl)" }} />
      <div className={ui.section}>
        <div className={ui.skeleton} style={{ height: 28, width: 200, marginBottom: 16 }} />
        <div className={ui.cardGrid}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <Artwork radius="lg" className={ui.skeleton} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
