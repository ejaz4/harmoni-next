"use client";

import Link from "next/link";
import { usePlayer } from "@/components/player/player";
import { Artwork, PlayButton, ui } from "@/components/ui";
import type { SongResult } from "@/server/library/song-view";

// A square card for a song in a grid; playing it queues the whole grid.
export function SongCard({ song, list, index }: { song: SongResult; list: SongResult[]; index: number }) {
  const player = usePlayer();
  const isCurrent = player.current?.id === song.id;
  const artist = song.artists[0];
  return (
    <div className={ui.card}>
      <div className={ui.cardArt}>
        <Artwork src={song.artworkUrl} alt="" radius="lg" />
        <PlayButton
          className={ui.cardPlay}
          playing={isCurrent && player.playing}
          onClick={() => (isCurrent ? player.toggle() : player.play(list, index))}
          label={`Play ${song.title}`}
        />
      </div>
      <span className={ui.cardTitle} title={song.title}>
        {song.title}
      </span>
      <span className={ui.cardSubtitle}>
        {artist?.id ? <Link href={`/artist/${artist.id}`}>{artist.name}</Link> : artist?.name}
      </span>
    </div>
  );
}

export function CardLink({ href, artwork, title, subtitle }: { href: string; artwork?: string; title: string; subtitle?: string }) {
  return (
    <Link href={href} className={ui.card}>
      <div className={ui.cardArt}>
        <Artwork src={artwork} alt="" radius="lg" />
      </div>
      <span className={ui.cardTitle}>{title}</span>
      {subtitle && <span className={ui.cardSubtitle}>{subtitle}</span>}
    </Link>
  );
}
