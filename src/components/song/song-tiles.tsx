"use client";

import { Icon } from "@/components/icon";
import { usePlayer } from "@/components/player/player";
import { Artwork, Shelf, useContextMenu } from "@/components/ui";
import type { SongResult } from "@/server/library/song-view";
import { SongMenu, SongMenuHeader, useSongMenu } from "./song-menu";
import { ArtistLinks, Equalizer, useHold } from "./song-list";
import styles from "./song-tiles.module.css";

// Songs as compact rows in columns of `rows`, paging sideways: a lot of
// songs in little height, for a home screen shelf.
export function SongTiles({ title, subtitle, link, songs, rows = 3 }: { title: string; subtitle?: string; link?: { href: string; label: string }; songs: SongResult[]; rows?: number }) {
  const columns: { song: SongResult; index: number }[][] = [];
  songs.forEach((song, index) => {
    if (index % rows === 0) columns.push([]);
    columns.at(-1)!.push({ song, index });
  });
  return (
    <Shelf title={title} subtitle={subtitle} link={link} kind="wide">
      {columns.map((column, c) => (
        <div key={c} className={styles.column}>
          {column.map(({ song, index }) => (
            <SongTile key={`${song.id}-${index}`} song={song} list={songs} index={index} />
          ))}
        </div>
      ))}
    </Shelf>
  );
}

function SongTile({ song, list, index }: { song: SongResult; list: SongResult[]; index: number }) {
  const player = usePlayer();
  const contextMenu = useContextMenu();
  const songMenu = useSongMenu();
  const isCurrent = player.current?.id === song.id;
  const hold = useHold(({ x, y, target }) => contextMenu({ x, y, target }, () => songMenu(song), { sheetHeader: <SongMenuHeader song={song} /> }));
  return (
    <div
      className={styles.tile}
      data-current={isCurrent || undefined}
      role="button"
      tabIndex={0}
      aria-label={`Play ${song.title}`}
      onClick={() => (isCurrent ? player.toggle() : player.play(list, index))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget === e.target && player.play(list, index)}
      onContextMenu={(e) => contextMenu(e, () => songMenu(song), { sheetHeader: <SongMenuHeader song={song} /> })}
      {...hold}
    >
      <span className={styles.art}>
        <Artwork src={song.artworkUrl} size={48} radius="sm" />
        <span className={styles.artOverlay}>{isCurrent && player.playing ? <Equalizer /> : <Icon name="play" />}</span>
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{song.title}</span>
        <span className={styles.artist}>
          <ArtistLinks artists={song.artists} />
        </span>
      </span>
      <span className={styles.more}>
        <SongMenu song={song} />
      </span>
    </div>
  );
}
