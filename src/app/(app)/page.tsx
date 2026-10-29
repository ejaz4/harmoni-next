"use client";

import Link from "next/link";
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
import type { Shelf } from "@/server/discovery/home";
import type { ArtistCard } from "@/server/library/catalogue";
import type { PlaylistSummary } from "@/server/library/service";
import type { SongResult } from "@/server/library/song-view";
import styles from "./pages.module.css";

const noSubscribe = () => () => {};

interface HomeData {
  recent: SongResult[];
  liked: SongResult[];
  playlists: PlaylistSummary[];
  shelves?: Shelf[]; // only with Super Processing on
}

type SongShelf = Extract<Shelf, { kind: "mix" | "repeat" | "rediscover" }>;

export default function HomePage() {
  const library = useLibrary();
  const { data } = useApi<HomeData>("/api/home", library.version);
  const user = useUser();
  // Uses the local clock, so the server renders a neutral "Hello".
  const hello = useSyncExternalStore(noSubscribe, greeting, () => "Hello");
  const name = user?.name?.split(" ")[0];

  if (!data) return <HomeSkeleton />;
  const fresh = !data.recent.length && !data.liked.length;
  const shelves = data.shelves ?? [];
  const mix = shelves.find((s): s is SongShelf => s.kind === "mix");
  const greet = (
    <>
      {hello}
      {name ? `, ${name}` : ""}
    </>
  );

  return (
    <>
      {mix ? (
        <MixHero greet={greet} songs={mix.songs} />
      ) : fresh ? (
        <WelcomeHero greet={greet} />
      ) : (
        <ResumeHero greet={greet} recent={data.recent} />
      )}

      {data.recent.length > 0 && (
        <Section title="Jump back in" link={{ href: "/recent", label: "See all" }}>
          <div className={`${ui.cardGrid} ${styles.shelfRow}`}>
            {data.recent.slice(0, 6).map((song, i) => (
              <SongCard key={song.id} song={song} list={data.recent} index={i} />
            ))}
          </div>
        </Section>
      )}

      {shelves.map((shelf, i) => (
        <PersonalShelf key={`${shelf.kind}-${i}`} shelf={shelf} />
      ))}

      {data.shelves && !shelves.length && !fresh && (
        <Section title="Made for you">
          <EmptyState title="Your mixes are on the way" body="Harmoni is learning what you like. Keep listening and your home screen will fill with picks for you." />
        </Section>
      )}

      {data.liked.length > 0 && (
        <Section title="Songs you love" link={{ href: "/liked", label: "See all" }}>
          <SongList songs={data.liked.slice(0, 6)} />
        </Section>
      )}

      {data.playlists.length > 0 && (
        <Section title="Your playlists">
          <div className={`${ui.cardGrid} ${styles.shelfRow}`}>
            {data.playlists.map((p) => (
              <CardLink key={p.id} href={`/playlist/${p.id}`} artwork={p.artworks[0]} title={p.name} subtitle={plural(p.count, "song")} />
            ))}
          </div>
        </Section>
      )}

      {!data.shelves && !fresh && (
        <Section title="Made for you">
          <EmptyState
            title="Get mixes made for you"
            body="Turn on Super Processing and Harmoni learns what you like from how you listen, then fills this page with new finds, old favourites and a mix of its own."
            action={
              <Link href="/settings#super-processing" className={`${ui.button} ${ui.buttonPrimary}`}>
                Turn it on in Settings
              </Link>
            }
          />
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

function PersonalShelf({ shelf }: { shelf: Shelf }) {
  switch (shelf.kind) {
    case "mix":
      return (
        <Section title="From your mix">
          <SongList songs={shelf.songs.slice(0, 6)} />
        </Section>
      );
    case "because":
      return (
        <Section title={`More like ${shelf.seed.title}`}>
          <SongGrid songs={shelf.songs} />
        </Section>
      );
    case "repeat":
      return (
        <Section title="On repeat">
          <SongGrid songs={shelf.songs} />
        </Section>
      );
    case "rediscover":
      return (
        <Section title="Rediscover">
          <SongList songs={shelf.songs.slice(0, 6)} />
        </Section>
      );
    case "artists":
      return <ArtistShelf title="Artists you might like" artists={shelf.artists} />;
    case "top-artists":
      return <ArtistShelf title="Your top artists" artists={shelf.artists} />;
  }
}

// Six cards; playing one queues the whole shelf.
function SongGrid({ songs }: { songs: SongResult[] }) {
  return (
    <div className={`${ui.cardGrid} ${styles.shelfRow}`}>
      {songs.slice(0, 6).map((song, i) => (
        <SongCard key={song.id} song={song} list={songs} index={i} />
      ))}
    </div>
  );
}

function ArtistShelf({ title, artists }: { title: string; artists: ArtistCard[] }) {
  return (
    <Section title={title}>
      <div className={styles.artistRow}>
        {artists.map((a) => (
          <Link key={a.id} href={`/artist/${a.id}`} className={styles.artistChip}>
            <Artwork src={`/api/artists/${a.id}/image`} fallbackSrc={a.imageUrl} alt="" className={styles.artistPhoto} />
            <span className={styles.artistName}>{a.name}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

// Super Processing's mix, front and centre.
function MixHero({ greet, songs }: { greet: React.ReactNode; songs: SongResult[] }) {
  const player = usePlayer();
  const first = songs[0];
  const theme = useArtworkTheme(first.id);
  const style = { "--hero-color": theme?.color, "--hero-ink": theme?.ink, "--hero-ink-muted": theme?.inkMuted } as React.CSSProperties;
  const artists = [...new Set(songs.flatMap((s) => s.artists[0]?.name ?? []))].slice(0, 3);
  const playing = songs.some((s) => s.id === player.current?.id) && player.playing;

  return (
    <section className={styles.hero} style={style}>
      {first.artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.heroArt} src={`/api/songs/${first.id}/artwork`} alt="" />
      )}
      <div className={styles.heroBody}>
        <span className={styles.heroEyebrow}>{greet}</span>
        <h1 className={styles.heroTitle}>Your mix, made for you</h1>
        <p className={styles.heroText}>
          New music picked from how you listen{artists.length ? `, with ${joinNames(artists)}` : ""}.
        </p>
        <div className={styles.heroActions}>
          <PlayButton className={styles.heroPlay} playing={playing} onClick={() => (playing ? player.toggle() : player.play(songs, 0))} label="Play your mix" />
          <span className={styles.heroMeta}>{plural(songs.length, "song")}</span>
        </div>
      </div>
    </section>
  );
}

const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);

function ResumeHero({ greet, recent }: { greet: React.ReactNode; recent: SongResult[] }) {
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
        <span className={styles.heroEyebrow}>{greet}</span>
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

function WelcomeHero({ greet }: { greet: React.ReactNode }) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroBody}>
        <span className={styles.heroEyebrow}>{greet}</span>
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
