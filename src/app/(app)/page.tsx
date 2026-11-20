"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import { usePlayer } from "@/components/player/player";
import { useLibrary } from "@/components/providers/library";
import { useUser } from "@/components/providers/user";
import { collectionHref, useCollectionMenu, useCollectionPlayer, type CollectionRef } from "@/components/song/collection-menu";
import { ArtistCard, CollectionCard, SongCard } from "@/components/song/song-card";
import { SongTiles } from "@/components/song/song-tiles";
import { SpiceArt } from "@/components/spice/spice-art";
import { SpiceCardLink } from "@/components/spice/spice-card";
import { DAILY_SPICE_HREF, useDailySpice } from "@/components/spice/use-daily-spice";
import { Artwork, EmptyState, PlayButton, Section, Shelf, ui, useContextMenu } from "@/components/ui";
import { useArtworkTheme } from "@/lib/artwork-theme";
import { greeting, plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Shelf as HomeShelf } from "@/server/discovery/home";
import type { ArtistCard as Artist } from "@/server/library/catalogue";
import type { PlaylistSummary } from "@/server/library/service";
import type { SongResult } from "@/server/library/song-view";
import styles from "./home.module.css";

const noSubscribe = () => () => {};
const today = () => new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

interface HomeData {
  recent: SongResult[];
  liked: SongResult[];
  playlists: PlaylistSummary[];
  shelves?: HomeShelf[]; // only with Super Processing on
}

type SongShelf = Extract<HomeShelf, { kind: "mix" | "repeat" | "rediscover" }>;

// Home, top to bottom: who it's for and when; the one thing to play now
// beside the places you go most; then shelves, most personal first.
export default function HomePage() {
  const library = useLibrary();
  const { data } = useApi<HomeData>("/api/home", library.version);
  const user = useUser();
  // Uses the local clock, so the server renders a neutral "Hello".
  const hello = useSyncExternalStore(noSubscribe, greeting, () => "Hello");
  const date = useSyncExternalStore(noSubscribe, today, () => "");
  const name = user?.name?.split(" ")[0];

  if (!data) return <HomeSkeleton />;
  const fresh = !data.recent.length && !data.liked.length;
  const shelves = data.shelves ?? [];
  const mix = shelves.find((s): s is SongShelf => s.kind === "mix");

  return (
    <div className={`${styles.home} ${ui.reveal}`}>
      <header className={styles.intro}>
        <p className={styles.date}>{date || " "}</p>
        <h1 className={styles.greeting}>
          {hello}
          {name ? `, ${name}` : ""}
        </h1>
      </header>

      <div className={styles.top}>
        {mix ? <MixHero songs={mix.songs} /> : fresh ? <WelcomeHero /> : <ResumeHero recent={data.recent} />}
        <Shortcuts />
      </div>

      {data.recent.length > 0 && (
        <Shelf title="Jump back in" subtitle="What you've been playing lately" link={{ href: "/recent", label: "Show all" }}>
          {data.recent.slice(0, 16).map((song, i) => (
            <SongCard key={`${song.id}-${i}`} song={song} list={data.recent} index={i} />
          ))}
        </Shelf>
      )}

      {shelves.map((shelf, i) => (
        <PersonalShelf key={`${shelf.kind}-${i}`} shelf={shelf} />
      ))}

      {data.shelves && !shelves.length && !fresh && (
        <Section title="Made for you">
          <EmptyState icon="sparkle" title="Your mixes are on the way" body="Harmoni is learning what you like. Keep listening and your home screen will fill with picks for you." />
        </Section>
      )}

      {data.liked.length > 0 && <SongTiles title="Songs you love" subtitle="Your latest likes" link={{ href: "/liked", label: "Show all" }} songs={data.liked.slice(0, 18)} />}

      {library.collections.length > 0 && (
        <Shelf title="Your playlists and Spices" link={{ href: "/library", label: "Show all" }}>
          {library.collections.map((c) =>
            c.type === "playlist" ? (
              <CollectionCard
                key={c.playlist.id}
                collection={{ kind: "playlist", id: c.playlist.id, name: c.playlist.name }}
                art={<Artwork src={c.playlist.artworks[0]} alt="" radius="lg" />}
                subtitle={`Playlist · ${plural(c.playlist.count, "song")}`}
              />
            ) : (
              <SpiceCardLink key={c.spice.id} spice={c.spice} />
            ),
          )}
        </Shelf>
      )}

      {!data.shelves && !fresh && (
        <Section title="Made for you">
          <EmptyState
            icon="sparkle"
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
            icon="globe"
            title="One search, every source"
            body="Search once and Harmoni asks YouTube Music, Deezer, iTunes and TIDAL together, then merges the results so each song shows up once. If one source goes down, your music keeps playing from another."
          />
        </Section>
      )}
    </div>
  );
}

function PersonalShelf({ shelf }: { shelf: HomeShelf }) {
  switch (shelf.kind) {
    case "mix":
      return <SongShelf title="From your mix" subtitle="New music picked from how you listen" songs={shelf.songs} />;
    case "because":
      return <SongShelf title={`More like ${shelf.seed.title}`} subtitle={`Because you play ${shelf.seed.artists[0]?.name ?? "it"}`} songs={shelf.songs} />;
    case "repeat":
      return <SongShelf title="On repeat" subtitle="The songs you can't stop playing" songs={shelf.songs} />;
    case "rediscover":
      return <SongTiles title="Rediscover" subtitle="Old favourites you haven't heard in a while" songs={shelf.songs} />;
    case "artists":
      return <ArtistShelf title="Artists you might like" artists={shelf.artists} />;
    case "top-artists":
      return <ArtistShelf title="Your top artists" artists={shelf.artists} />;
  }
}

// Playing one card queues the whole shelf after it.
function SongShelf({ title, subtitle, songs }: { title: string; subtitle?: string; songs: SongResult[] }) {
  return (
    <Shelf title={title} subtitle={subtitle}>
      {songs.map((song, i) => (
        <SongCard key={`${song.id}-${i}`} song={song} list={songs} index={i} />
      ))}
    </Shelf>
  );
}

function ArtistShelf({ title, artists }: { title: string; artists: Artist[] }) {
  return (
    <Shelf title={title} kind="artists">
      {artists.map((a) => (
        <ArtistCard key={a.id} artist={a} />
      ))}
    </Shelf>
  );
}

// --- The top: a hero, and shortcuts beside it ---

function Hero({
  songId,
  kicker,
  title,
  text,
  actions,
  art,
}: {
  songId?: string;
  kicker: string;
  title: string;
  text: ReactNode;
  actions: ReactNode;
  art?: ReactNode;
}) {
  const theme = useArtworkTheme(songId);
  const style = { "--hero-color": theme?.color, "--hero-deep": theme?.deep, "--hero-ink": theme?.ink, "--hero-ink-muted": theme?.inkMuted } as React.CSSProperties;
  return (
    <section className={styles.hero} style={style} data-themed={theme ? true : undefined}>
      {art}
      <div className={styles.heroBody}>
        <span className={styles.heroKicker}>{kicker}</span>
        <h2 className={styles.heroTitle}>{title}</h2>
        <p className={styles.heroText}>{text}</p>
        <div className={styles.heroActions}>{actions}</div>
      </div>
    </section>
  );
}

// A fan of the mix's covers, the first one in front.
function CoverFan({ songs }: { songs: SongResult[] }) {
  const covers = songs.filter((s) => s.artworkUrl).slice(0, 3);
  if (!covers.length) return null;
  return (
    <div className={styles.fan} aria-hidden>
      {covers
        .map((s, i) => (
          <div key={s.id} className={styles.fanCover} data-at={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/songs/${s.id}/artwork?w=512`} alt="" />
          </div>
        ))
        .reverse()}
    </div>
  );
}

// Super Processing's mix, front and centre.
function MixHero({ songs }: { songs: SongResult[] }) {
  const player = usePlayer();
  const artists = [...new Set(songs.flatMap((s) => s.artists[0]?.name ?? []))].slice(0, 3);
  const playing = songs.some((s) => s.id === player.current?.id) && player.playing;
  return (
    <Hero
      songId={songs[0].id}
      kicker="Made for you"
      title="Your mix"
      text={<>New music picked from how you listen{artists.length ? `, with ${joinNames(artists)}` : ""}.</>}
      art={<CoverFan songs={songs} />}
      actions={
        <>
          <PlayButton size="lg" className={styles.heroPlay} playing={playing} onClick={() => (playing ? player.toggle() : player.play(songs, 0))} label={playing ? "Pause" : "Play your mix"} />
          <button type="button" className={styles.heroShuffle} onClick={() => player.play(songs, Math.floor(Math.random() * songs.length), { shuffle: true })}>
            <Icon name="shuffle" /> Shuffle
          </button>
          <span className={styles.heroMeta}>{plural(songs.length, "song")}</span>
        </>
      }
    />
  );
}

const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]);

function ResumeHero({ recent }: { recent: SongResult[] }) {
  const player = usePlayer();
  const last = recent[0];
  const others = [...new Set(recent.slice(1).flatMap((s) => s.artists.map((a) => a.name)))].filter((n) => n !== last.artists[0]?.name).slice(0, 2);
  const playing = recent.some((s) => s.id === player.current?.id) && player.playing;
  return (
    <Hero
      songId={last.id}
      kicker="Pick up where you left off"
      title={last.title}
      text={
        <>
          {last.artists[0]?.name}
          {others.length ? `, with a bit of ${others.join(" and ")} before that.` : "."}
        </>
      }
      art={<CoverFan songs={recent} />}
      actions={
        <>
          <PlayButton size="lg" className={styles.heroPlay} playing={playing} onClick={() => (playing ? player.toggle() : player.play(recent, 0))} label={playing ? "Pause" : "Play your recent songs"} />
          <span className={styles.heroMeta}>{plural(recent.length, "song")} you played lately</span>
        </>
      }
    />
  );
}

function WelcomeHero() {
  return (
    <Hero
      kicker="Welcome to Harmoni"
      title="Let's find your sound"
      text="Search for a song or an artist you love. Press / to jump to search from anywhere."
      actions={
        <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={() => document.getElementById("global-search")?.focus()}>
          <Icon name="search" /> Start searching
        </button>
      }
    />
  );
}

interface ShortcutItem {
  collection: CollectionRef;
  art: ReactNode;
}

// The places you go most, a click away: Liked Songs, your Daily Spice, and
// your newest playlists and Spices.
function Shortcuts() {
  const library = useLibrary();
  const daily = useDailySpice();
  const items: ShortcutItem[] = [
    { collection: { kind: "liked", name: "Liked Songs" } as CollectionRef, art: <ShortcutTile icon="heart-solid" tone="liked" /> },
    ...(daily ? [{ collection: { kind: "spice", id: "daily", name: daily.label } as CollectionRef, art: <SpiceArt name={daily.label} label={false} /> }] : []),
    ...library.collections.map((c) =>
      c.type === "playlist"
        ? { collection: { kind: "playlist", id: c.playlist.id, name: c.playlist.name } as CollectionRef, art: <Artwork src={c.playlist.artworks[0]} alt="" radius="sm" /> }
        : { collection: { kind: "spice", id: c.spice.id, name: c.spice.name } as CollectionRef, art: <SpiceArt name={c.spice.name} covers={c.spice.covers} label={false} /> },
    ),
    ...library.shared.map((p) => ({ collection: { kind: "playlist", id: p.id, name: p.name } as CollectionRef, art: <Artwork src={p.artworks[0]} alt="" radius="sm" /> })),
    { collection: { kind: "recent", name: "Recently Played" } as CollectionRef, art: <ShortcutTile icon="history" tone="recent" /> },
  ].slice(0, 8);
  return (
    <nav className={styles.shortcuts} aria-label="Shortcuts" data-count={items.length}>
      {items.map((item) => (
        <Shortcut key={collectionHref(item.collection)} {...item} />
      ))}
    </nav>
  );
}

function ShortcutTile({ icon, tone }: { icon: IconName; tone: "liked" | "recent" }) {
  return (
    <span className={styles.shortcutTile} data-tone={tone}>
      <Icon name={icon} />
    </span>
  );
}

function Shortcut({ collection, art }: ShortcutItem) {
  const { run, isLoading } = useCollectionPlayer();
  const collectionMenu = useCollectionMenu();
  const contextMenu = useContextMenu();
  const href = collection.kind === "spice" && collection.id === "daily" ? DAILY_SPICE_HREF : collectionHref(collection);
  return (
    <div className={styles.shortcut} onContextMenu={(e) => contextMenu(e, () => collectionMenu(collection))}>
      <span className={styles.shortcutArt}>{art}</span>
      <Link href={href} className={styles.shortcutName}>
        {collection.name}
      </Link>
      <PlayButton size="sm" className={styles.shortcutPlay} playing={isLoading(collection)} onClick={() => void run(collection)} label={`Play ${collection.name}`} />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className={styles.home} aria-busy="true" aria-label="Loading">
      <header className={styles.intro}>
        <div className={ui.skeleton} style={{ height: 14, width: 140, marginBottom: 12 }} />
        <div className={ui.skeleton} style={{ height: 40, width: 320 }} />
      </header>
      <div className={styles.top}>
        <div className={`${ui.skeleton} ${styles.hero}`} />
        <div className={styles.shortcuts} data-count={8}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`${ui.skeleton} ${styles.shortcut}`} />
          ))}
        </div>
      </div>
      <div className={ui.section}>
        <div className={ui.skeleton} style={{ height: 26, width: 200, marginBottom: 16 }} />
        <div className={styles.skeletonRow}>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={ui.skeleton} style={{ aspectRatio: "1", borderRadius: "var(--radius-lg)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
