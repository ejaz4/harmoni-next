"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { usePlayer } from "@/components/player/player";
import { useLibrary } from "@/components/providers/library";
import { Artwork, useContextMenu, type MenuItem } from "@/components/ui";
import { formatDuration } from "@/lib/format";
import type { SongResult } from "@/server/library/song-view";
import { LikeButton } from "./like-button";
import { SongMenu, SongMenuHeader, useSongMenu } from "./song-menu";
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

const HOLD_MS = 450;
const HOLD_SLOP_PX = 10;

// Holding something on a touch screen opens its menu, like a right-click.
// The click that ends a hold is swallowed, so it doesn't also play the song.
export function useHold(onHold: (at: { x: number; y: number; target: HTMLElement }) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const held = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = undefined;
  };
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      held.current = false;
      if (e.pointerType !== "touch") return;
      cancel();
      const target = e.currentTarget;
      const at = { x: e.clientX, y: e.clientY };
      start.current = at;
      timer.current = window.setTimeout(() => {
        held.current = true;
        navigator.vibrate?.(10);
        onHold({ ...at, target });
      }, HOLD_MS);
    },
    onPointerMove(e: React.PointerEvent) {
      const from = start.current;
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > HOLD_SLOP_PX) cancel();
    },
    onPointerUp() {
      cancel();
      if (!held.current) return;
      const swallow = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
    },
    onPointerCancel: cancel, // scrolling
  };
}

// Track rows. Clicking (tapping) a row plays the list from that song;
// right-clicking (or holding) opens its menu where you clicked. On touch
// screens the names in it aren't links, so a tap anywhere plays.
export function SongList({
  songs,
  numbered,
  showAlbum = true,
  rowMenu,
  single,
  header,
}: {
  songs: SongResult[];
  // A queue of just the tapped song (search results), not the list from there.
  single?: boolean;
  numbered?: boolean;
  showAlbum?: boolean;
  rowMenu?: (song: SongResult, index: number) => MenuItem[];
  header?: boolean; // column titles above the rows (defaults to on for numbered lists)
}) {
  const player = usePlayer();
  const library = useLibrary();
  const contextMenu = useContextMenu();
  const songMenu = useSongMenu();
  const start = (i: number) => (single ? player.play([songs[i]], 0) : player.play(songs, i));
  const [shown, setShown] = useState(BATCH);
  const end = useRef<HTMLLIElement>(null);
  const menuFor = (i: number) => () => songMenu(songs[i], rowMenu?.(songs[i], i));
  const hold = useHold(({ x, y, target }) => {
    const i = Number(target.dataset.index);
    contextMenu({ x, y, target }, menuFor(i), { sheetHeader: <SongMenuHeader song={songs[i]} /> });
  });

  // Thousands of songs (a big playlist) go in a batch at a time, the next
  // well before it's scrolled to.
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const watch = new IntersectionObserver(([e]) => e.isIntersecting && setShown((n) => n + BATCH), { root: scroller(el), rootMargin: "1500px 0px" });
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, songs.length]);

  return (
    <div className={`${styles.listWrap} ${showAlbum ? "" : styles.noAlbum}`}>
      {(header ?? numbered) && songs.length > 0 && (
        <div className={`${styles.row} ${styles.headerRow}`} aria-hidden>
          <div className={styles.lead}>
            {numbered && <span className={styles.number}>#</span>}
            <span className={styles.headerArtGap} />
          </div>
          <span>Title</span>
          {showAlbum && <span className={styles.album}>Album</span>}
          <span />
          <span className={styles.duration}>
            <Icon name="clock" />
          </span>
          <span />
        </div>
      )}
      <ol className={styles.list}>
        {songs.slice(0, shown).map((song, i) => {
          const isCurrent = player.current?.id === song.id;
          const liked = library.isLiked(song.id);
          return (
            <li
              key={`${song.id}-${i}`}
              className={`${styles.row} ${isCurrent ? styles.current : ""}`}
              data-index={i}
              onClick={() => (isCurrent ? player.toggle() : start(i))}
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget === e.target && start(i)}
              onContextMenu={(e) => contextMenu(e, menuFor(i), { sheetHeader: <SongMenuHeader song={song} /> })}
              {...hold}
            >
              <div className={styles.lead}>
                {numbered && (
                  <span className={`${styles.number} tabular`}>
                    {isCurrent && player.playing ? <Equalizer /> : i + 1}
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
                  <span className={styles.titleText}>{song.title}</span>
                  {song.explicit && (
                    <span className={styles.explicit} title="Explicit" aria-label="Explicit">
                      E
                    </span>
                  )}
                </span>
                <span className={styles.artists}>
                  {liked && <Icon name="heart-solid" className={styles.likedMark} label="Liked" />}
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
              <span className={`${styles.like} ${liked ? styles.liked : ""}`}>
                <LikeButton song={song} />
              </span>
              <span className={`${styles.duration} tabular`}>{formatDuration(song.durationMs)}</span>
              <span className={styles.more}>
                <SongMenu song={song} extra={rowMenu?.(song, i)} />
              </span>
            </li>
          );
        })}
        {shown < songs.length && <li ref={end} aria-hidden style={{ height: 1 }} />}
      </ol>
    </div>
  );
}

// Three bars bouncing where the playing song's number was.
export function Equalizer({ className }: { className?: string }) {
  return (
    <span className={`${styles.equalizer} ${className ?? ""}`} aria-label="Playing" role="img">
      <span />
      <span />
      <span />
    </span>
  );
}

const BATCH = 150;

// What the list scrolls in: the page's main column, or the window.
function scroller(el: HTMLElement): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}
