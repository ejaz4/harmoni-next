"use client";

import type { ReactNode } from "react";
import pageStyles from "@/app/(app)/pages.module.css";
import { usePlayer } from "@/components/player/player";
import { Artwork, IconButton, PlayButton, ui } from "@/components/ui";
import { useArtworkTheme } from "@/lib/artwork-theme";
import { formatTotal, plural } from "@/lib/format";
import type { SongResult } from "@/server/library/song-view";

// Header for albums, playlists, artists and Liked Songs: tinted from the
// first song's artwork, with play and shuffle for the whole list.
export function CollectionHeader({
  kind,
  title,
  artwork,
  round,
  meta,
  description,
  songs,
  actions,
  trailing,
}: {
  kind: string;
  title: string;
  artwork?: ReactNode;
  round?: boolean;
  meta?: ReactNode;
  description?: string;
  songs: SongResult[];
  actions?: ReactNode;
  trailing?: ReactNode; // at the far end of the buttons, like sorting
}) {
  const player = usePlayer();
  const theme = useArtworkTheme(songs.find((s) => s.artworkUrl)?.id);
  const total = songs.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
  const isThisList = songs.length > 0 && player.queue.length === songs.length && player.queue.every((s, i) => s.id === songs[i]?.id);

  return (
    <>
      <header className={pageStyles.header} style={{ "--hero-color": theme?.color } as React.CSSProperties} data-themed={theme ? true : undefined}>
        <div className={`${pageStyles.headerArt} ${round ? pageStyles.headerArtRound : ""}`}>
          {artwork ?? <Artwork src={songs.find((s) => s.artworkUrl)?.artworkUrl} size={232} radius="lg" />}
        </div>
        <div className={pageStyles.headerBody}>
          <span className={pageStyles.headerKind}>{kind}</span>
          <h1 className={pageStyles.headerTitle} data-long={title.length > 28 || undefined}>
            {title}
          </h1>
          {description && <p className={pageStyles.headerDescription}>{description}</p>}
          <p className={pageStyles.headerMeta}>
            {meta}
            {meta ? <span className={pageStyles.metaDot}>·</span> : null}
            {plural(songs.length, "song")}
            {total > 0 && <span className={pageStyles.metaQuiet}>, {formatTotal(total)}</span>}
          </p>
        </div>
      </header>
      <div className={pageStyles.actions}>
        <PlayButton
          size="lg"
          playing={isThisList && player.playing}
          onClick={() => (isThisList ? player.toggle() : player.play(songs, 0))}
          label={isThisList && player.playing ? "Pause" : `Play ${title}`}
        />
        <IconButton
          icon="shuffle"
          label="Shuffle play"
          className={pageStyles.actionButton}
          onClick={() => songs.length && player.play(songs, Math.floor(Math.random() * songs.length), { shuffle: true })}
        />
        {actions}
        {trailing && <div className={pageStyles.actionsEnd}>{trailing}</div>}
      </div>
    </>
  );
}

export function CollectionSkeleton() {
  return (
    <div className={pageStyles.headerSkeleton}>
      <div className={`${ui.skeleton} ${pageStyles.headerArt}`} style={{ borderRadius: "var(--radius-lg)" }} />
      <div style={{ flex: 1 }}>
        <div className={ui.skeleton} style={{ height: 14, width: 80, marginBottom: 14 }} />
        <div className={ui.skeleton} style={{ height: 48, width: "60%", marginBottom: 14 }} />
        <div className={ui.skeleton} style={{ height: 14, width: 160 }} />
      </div>
    </div>
  );
}
