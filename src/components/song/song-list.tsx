"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

const HOLD_MS = 450;
const HOLD_SLOP_PX = 10;

// Holding a row on a touch screen (or right-clicking it) opens its menu.
// The click that ends a hold is swallowed, so it doesn't also play the song.
function useHold(onHold: (i: number) => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number; i: number } | undefined>(undefined);
  const held = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = undefined;
  };
  return (i: number) => ({
    onPointerDown(e: React.PointerEvent) {
      held.current = false;
      if (e.pointerType !== "touch") return;
      cancel();
      start.current = { x: e.clientX, y: e.clientY, i };
      timer.current = window.setTimeout(() => {
        held.current = true;
        navigator.vibrate?.(10);
        onHold(i);
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
    onContextMenu(e: React.MouseEvent) {
      e.preventDefault();
      onHold(i);
    },
  });
}

// Track rows. Clicking (tapping) a row plays the list from that song; on
// touch screens the names in it aren't links, so a tap anywhere plays.
export function SongList({
  songs,
  numbered,
  showAlbum = true,
  rowMenu,
  single,
}: {
  songs: SongResult[];
  // A queue of just the tapped song (search results), not the list from there.
  single?: boolean;
  numbered?: boolean;
  showAlbum?: boolean;
  rowMenu?: (song: SongResult, index: number) => MenuItem[];
}) {
  const player = usePlayer();
  const library = useLibrary();
  const start = (i: number) => (single ? player.play([songs[i]], 0) : player.play(songs, i));
  const [menuFor, setMenuFor] = useState<number>();
  const hold = useHold(setMenuFor);
  const [shown, setShown] = useState(BATCH);
  const end = useRef<HTMLLIElement>(null);

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
    <ol className={`${styles.list} ${showAlbum ? "" : styles.noAlbum}`}>
      {songs.slice(0, shown).map((song, i) => {
        const isCurrent = player.current?.id === song.id;
        const liked = library.isLiked(song.id);
        return (
          <li
            key={`${song.id}-${i}`}
            className={`${styles.row} ${isCurrent ? styles.current : ""}`}
            onClick={() => (isCurrent ? player.toggle() : start(i))}
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget === e.target && start(i)}
            {...hold(i)}
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
            <span className={`${styles.like} ${liked ? styles.liked : ""}`} onClick={(e) => e.stopPropagation()}>
              <IconButton icon={liked ? "heart-solid" : "heart"} label={liked ? "Remove from Liked" : "Add to Liked"} onClick={() => library.toggleLike(song)} />
            </span>
            <span className={`${styles.duration} tabular`}>{formatDuration(song.durationMs)}</span>
            <span className={styles.more}>
              <SongMenu
                song={song}
                extra={rowMenu?.(song, i)}
                open={menuFor === i}
                onOpenChange={(open) => setMenuFor(open ? i : undefined)}
              />
            </span>
          </li>
        );
      })}
      {shown < songs.length && <li ref={end} aria-hidden style={{ height: 1 }} />}
    </ol>
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
