"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useState } from "react";
import { usePlayer } from "@/components/player/player";
import { useCollectionMenu } from "@/components/song/collection-menu";
import { ArtistCard, CardLink } from "@/components/song/song-card";
import { SongList } from "@/components/song/song-list";
import { Artwork, EmptyState, IconButton, PlayButton, Section, Shelf, ui, useContextMenu } from "@/components/ui";
import { useImageTheme } from "@/lib/artwork-theme";
import { useApi } from "@/lib/use-api";
import type { AlbumCard, ArtistPage as ArtistData } from "@/server/library/catalogue";
import styles from "../../artist.module.css";

const KIND_LABELS: Record<string, string> = { album: "Album", ep: "EP", single: "Single", compilation: "Compilation" };

export default function ArtistPage() {
  return (
    <Suspense fallback={<ArtistSkeleton />}>
      <ArtistContent />
    </Suspense>
  );
}

function ArtistContent() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<ArtistData>(`/api/artists/${id}`);
  if (error) return <EmptyState title="Artist not found" body="Try searching for them; Harmoni learns about artists as you search." />;
  if (!data) return <ArtistSkeleton />;
  return <Artist artist={data} />;
}

function Artist({ artist }: { artist: ArtistData }) {
  const player = usePlayer();
  const contextMenu = useContextMenu();
  const collectionMenu = useCollectionMenu();
  const theme = useImageTheme(artist.imageUrl ? `/api/artists/${artist.id}/image` : undefined);
  const [showAllPopular, setShowAllPopular] = useState(false);
  const releaseCount = artist.albums.length + artist.singles.length + artist.compilations.length;
  const playPopular = (shuffle = false) => {
    if (!artist.popular.length) return;
    player.play(artist.popular, shuffle ? Math.floor(Math.random() * artist.popular.length) : 0, { shuffle });
  };

  return (
    <>
      <header
        className={styles.hero}
        data-banner={artist.bannerUrl ? true : undefined}
        style={{ "--hero-color": theme?.color, "--hero-deep": theme?.deep } as React.CSSProperties}
      >
        {artist.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.banner} src={artist.bannerUrl} alt="" />
        ) : (
          artist.imageUrl && <Artwork src={artist.imageUrl} alt="" radius="xl" className={styles.portrait} />
        )}
        <div className={styles.heroBody}>
          <span className={styles.eyebrow}>Artist</span>
          <h1 className={styles.name}>{artist.name}</h1>
          <p className={styles.heroMeta}>
            {[artist.fans ? `${compact(artist.fans)} fans` : undefined, releaseCount ? `${releaseCount} releases` : undefined].filter(Boolean).join(" · ")}
          </p>
          <div className={styles.heroActions}>
            <PlayButton size="lg" onClick={() => playPopular()} label={`Play ${artist.name}`} />
            <IconButton icon="shuffle" label="Shuffle" onClick={() => playPopular(true)} />
          </div>
        </div>
      </header>

      <div className={styles.topRow}>
        <section className={styles.popular}>
          <h2 className={ui.sectionTitle}>Popular</h2>
          {artist.popular.length ? (
            <>
              <SongList songs={showAllPopular ? artist.popular : artist.popular.slice(0, 5)} numbered />
              {artist.popular.length > 5 && (
                <button type="button" className={styles.moreButton} onClick={() => setShowAllPopular((v) => !v)}>
                  {showAllPopular ? "Show less" : "Show more"}
                </button>
              )}
            </>
          ) : (
            <p className={styles.quiet}>No popular songs found yet.</p>
          )}
        </section>
        {artist.latest && (
          <aside className={styles.latest}>
            <h2 className={ui.sectionTitle}>Latest release</h2>
            <Link
              href={`/album/${artist.latest.id}`}
              className={styles.latestCard}
              onContextMenu={(e) =>
                contextMenu(e, () => collectionMenu({ kind: "album", id: artist.latest!.id, name: artist.latest!.title, artist: { id: artist.id, name: artist.name } }))
              }
            >
              <Artwork src={artist.latest.artworkUrl} alt="" radius="lg" className={styles.latestArt} />
              <span className={styles.latestKind}>
                {KIND_LABELS[artist.latest.kind ?? ""] ?? "Release"}
                {artist.latest.releaseDate && ` · ${formatDate(artist.latest.releaseDate)}`}
              </span>
              <span className={styles.latestTitle}>{artist.latest.title}</span>
              {artist.latest.trackCount ? <span className={styles.quiet}>{artist.latest.trackCount === 1 ? "1 song" : `${artist.latest.trackCount} songs`}</span> : null}
            </Link>
          </aside>
        )}
      </div>

      {artist.yours.length > 0 && (
        <Section title="Your favourites">
          <SongList songs={artist.yours} />
        </Section>
      )}

      <Releases title="Albums" releases={artist.albums} />
      <Releases title="Singles & EPs" releases={artist.singles} />
      <Releases title="Compilations" releases={artist.compilations} />

      {artist.bio && <About artist={artist} />}

      {artist.related.length > 0 && (
        <Shelf title="Fans also like" kind="artists">
          {artist.related.map((a) => (
            <ArtistCard key={a.id} artist={a} />
          ))}
        </Shelf>
      )}
    </>
  );
}

// A grid that shows two rows' worth, with the rest a click away.
function Releases({ title, releases }: { title: string; releases: AlbumCard[] }) {
  const [all, setAll] = useState(false);
  if (!releases.length) return null;
  const shown = all ? releases : releases.slice(0, 12);
  return (
    <Section title={title}>
      <div className={ui.cardGrid}>
        {shown.map((r) => (
          <CardLink
            key={r.id}
            href={`/album/${r.id}`}
            artwork={r.artworkUrl}
            title={r.title}
            subtitle={[r.releaseDate?.slice(0, 4), KIND_LABELS[r.kind ?? ""]].filter(Boolean).join(" · ")}
          />
        ))}
      </div>
      {releases.length > 12 && (
        <button type="button" className={styles.moreButton} onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : `Show all ${releases.length}`}
        </button>
      )}
    </Section>
  );
}

function About({ artist }: { artist: ArtistData }) {
  const [open, setOpen] = useState(false);
  const long = (artist.bio?.length ?? 0) > 420;
  return (
    <Section title="About">
      <div className={styles.about}>
        {artist.imageUrl && <Artwork src={artist.imageUrl} alt="" radius="xl" className={styles.aboutArt} />}
        <div className={styles.aboutBody}>
          {artist.fans ? <p className={styles.aboutStat}>{artist.fans.toLocaleString()} fans</p> : null}
          <p className={`${styles.bio} ${open || !long ? "" : styles.bioClamped}`}>{artist.bio}</p>
          {long && (
            <button type="button" className={styles.moreButton} onClick={() => setOpen((v) => !v)}>
              {open ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

function ArtistSkeleton() {
  return (
    <>
      <div className={`${styles.hero} ${ui.skeleton}`} />
      <div className={styles.topRow}>
        <div className={styles.popular}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={ui.skeleton} style={{ height: 52, marginBottom: 8, borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      </div>
    </>
  );
}

function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
