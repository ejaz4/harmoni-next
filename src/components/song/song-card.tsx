"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePlayer } from "@/components/player/player";
import { Artwork, Menu, PlayButton, ui, useContextMenu, type MenuItems } from "@/components/ui";
import type { SongResult } from "@/server/library/song-view";
import { collectionHref, useCollectionMenu, useCollectionPlayer, type CollectionRef } from "./collection-menu";
import { SongMenuHeader, useSongMenu } from "./song-menu";

// Every card in Harmoni: artwork that lifts on hover, a play button that
// rises into its corner, a ••• menu, and the same menu on right-click.
// `href` makes the whole card open something; `onActivate` makes it do
// something (play a song) instead.
export function MediaCard({
  art,
  title,
  subtitle,
  href,
  onActivate,
  onPlay,
  playing,
  current,
  menu,
  sheetHeader,
  round,
  label,
}: {
  art: ReactNode;
  title: string;
  subtitle?: ReactNode;
  href?: string;
  onActivate?: () => void;
  onPlay?: () => void;
  playing?: boolean;
  current?: boolean; // what's playing: its button stays up
  menu?: MenuItems;
  sheetHeader?: ReactNode;
  round?: boolean;
  label?: string; // what the main action says, for screen readers
}) {
  const contextMenu = useContextMenu();
  return (
    <div
      className={`${ui.card} ${round ? ui.cardRound : ""}`}
      data-current={current || undefined}
      onContextMenu={menu ? (e) => contextMenu(e, menu, { sheetHeader }) : undefined}
    >
      <div className={ui.cardArt}>
        <div className={ui.cardCover}>{art}</div>
        {onPlay && <PlayButton className={ui.cardPlay} playing={playing} onClick={onPlay} label={playing ? "Pause" : `Play ${title}`} />}
        {menu && (
          <span className={ui.cardMore}>
            <Menu items={menu} label={`More options for ${title}`} sheetHeader={sheetHeader} />
          </span>
        )}
      </div>
      <div className={ui.cardText}>
        {href ? (
          <Link href={href} className={`${ui.cardTitle} ${ui.cardAction}`} aria-label={label} title={title}>
            {title}
          </Link>
        ) : (
          <button type="button" className={`${ui.cardTitle} ${ui.cardAction}`} onClick={onActivate} aria-label={label} title={title}>
            {title}
          </button>
        )}
        {subtitle && <span className={ui.cardSubtitle}>{subtitle}</span>}
      </div>
    </div>
  );
}

// A song in a grid. The card plays it, queueing the rest of the grid after.
export function SongCard({ song, list, index }: { song: SongResult; list: SongResult[]; index: number }) {
  const player = usePlayer();
  const songMenu = useSongMenu();
  const isCurrent = player.current?.id === song.id;
  const artist = song.artists[0];
  const play = () => (isCurrent ? player.toggle() : player.play(list, index));
  return (
    <MediaCard
      art={<Artwork src={song.artworkUrl} alt="" radius="lg" />}
      title={song.title}
      subtitle={artist?.id ? <Link href={`/artist/${artist.id}`}>{artist.name}</Link> : artist?.name}
      onActivate={play}
      onPlay={play}
      playing={isCurrent && player.playing}
      current={isCurrent}
      label={`Play ${song.title}`}
      menu={() => songMenu(song)}
      sheetHeader={<SongMenuHeader song={song} />}
    />
  );
}

// A playlist, Spice, album or artist: opens on click, plays from its button.
export function CollectionCard({ collection, art, subtitle, round, extraMenu }: { collection: CollectionRef; art: ReactNode; subtitle?: ReactNode; round?: boolean; extraMenu?: MenuItems }) {
  const { run, isLoading } = useCollectionPlayer();
  const collectionMenu = useCollectionMenu();
  const extra = typeof extraMenu === "function" ? extraMenu : () => extraMenu ?? [];
  return (
    <MediaCard
      art={art}
      title={collection.name ?? ""}
      subtitle={subtitle}
      href={collectionHref(collection)}
      onPlay={() => void run(collection)}
      playing={isLoading(collection)}
      round={round}
      menu={() => collectionMenu(collection, extra())}
    />
  );
}

// Kept for pages that just link somewhere with a cover.
export function CardLink({ href, artwork, title, subtitle }: { href: string; artwork?: string; title: string; subtitle?: string }) {
  const match = href.match(/^\/(playlist|album|spice|artist)\/([^/?#]+)/);
  if (match) {
    return (
      <CollectionCard
        collection={{ kind: match[1] as "playlist", id: match[2], name: title }}
        art={<Artwork src={artwork} alt="" radius="lg" />}
        subtitle={subtitle}
      />
    );
  }
  return <MediaCard art={<Artwork src={artwork} alt="" radius="lg" />} title={title} subtitle={subtitle} href={href} />;
}

// An artist: a round photo that opens their page; plays their popular songs.
export function ArtistCard({ artist, subtitle }: { artist: { id: string; name: string; imageUrl?: string }; subtitle?: ReactNode }) {
  return (
    <CollectionCard
      round
      collection={{ kind: "artist", id: artist.id, name: artist.name }}
      art={<Artwork src={`/api/artists/${artist.id}/image`} fallbackSrc={artist.imageUrl} alt="" radius="xl" />}
      subtitle={subtitle ?? "Artist"}
    />
  );
}
