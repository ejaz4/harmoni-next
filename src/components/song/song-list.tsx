"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { usePlayer } from "@/components/player/player";
import { useLibrary } from "@/components/providers/library";
import { Artwork, IconButton, type MenuItem } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import type { SongResult } from "@/server/library/song-view";
import { SongMenu } from "./song-menu";
import styles from "./song.module.css";

export function ArtistLinks({ artists }: { artists: SongResult["artists"] }) {
  return (
    <>
      {artists.map((a, i) => (
        <span key={`${a.name}-${i}`}>
          {i > 0 && (a.role === "featured" && artists[i - 1]?.role !== "featured" ? " feat. " : ", ")}
          {a.id ? (
            <Link href={`/artist/${a.id}`} className={styles.link} onClick={(e) => e.stopPropagation()}>
              {a.name}
            </Link>
          ) : (
            a.name
          )}
        </span>
      ))}
    </>
  );
}

// Track rows. Clicking a row plays the list from that song.
export function SongList({
  songs,
  numbered,
  showAlbum = true,
  rowMenu,
}: {
  songs: SongResult[];
  numbered?: boolean;
  showAlbum?: boolean;
  rowMenu?: (song: SongResult, index: number) => MenuItem[];
}) {
  const player = usePlayer();
  const library = useLibrary();

  return (
    <ol className={`${styles.list} ${showAlbum ? "" : styles.noAlbum}`}>
      {songs.map((song, i) => {
        const isCurrent = player.current?.id === song.id;
        const liked = library.isLiked(song.id);
        return (
          <li
            key={`${song.id}-${i}`}
            className={`${styles.row} ${isCurrent ? styles.current : ""}`}
            onClick={() => (isCurrent ? player.toggle() : player.play(songs, i))}
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget === e.target && player.play(songs, i)}
          >
            <div className={styles.lead}>
              {numbered && (
                <span className={`${styles.number} tabular`}>
                  {isCurrent && player.playing ? <Icon name="music" /> : i + 1}
                </span>
              )}
              <div className={styles.artWrap}>
                <Artwork src={song.artworkUrl} size={44} radius="sm" />
                <span className={styles.artPlay}>
                  <Icon name={isCurrent && player.playing ? "pause" : "play"} />
                </span>
              </div>
            </div>
            <div className={styles.titles}>
              <span className={styles.title}>
                {song.title}
                {song.explicit && (
                  <span className={styles.explicit} title="Explicit" aria-label="Explicit">
                    E
                  </span>
                )}
              </span>
              <span className={styles.artists}>
                <ArtistLinks artists={song.artists} />
              </span>
            </div>
            {showAlbum && (
              <span className={styles.album}>
                {song.album?.id ? (
                  <Link href={`/album/${song.album.id}`} className={styles.link} onClick={(e) => e.stopPropagation()}>
                    {song.album.title}
                  </Link>
                ) : (
                  song.album?.title
                )}
              </span>
            )}
            <span className={`${styles.like} ${liked ? styles.liked : ""}`} onClick={(e) => e.stopPropagation()}>
              <IconButton icon={liked ? "heart-solid" : "heart"} label={liked ? "Remove from Liked" : "Add to Liked"} onClick={() => library.toggleLike(song)} />
            </span>
            <span className={`${styles.duration} tabular`}>{formatDuration(song.durationMs)}</span>
            <span className={styles.more}>
              <SongMenu song={song} extra={rowMenu?.(song, i)} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
