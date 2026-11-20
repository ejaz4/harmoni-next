"use client";

import { useRef, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences, useUser } from "@/components/providers/user";
import { SongMenuHeader, useSongMenu } from "@/components/song/song-menu";
import { Artwork, IconButton, useContextMenu } from "@/components/ui";
import styles from "./now-playing.module.css";
import { usePlayer, type QueueSong } from "./player";
import { useReorder } from "./reorder";

// What plays after this song: yours first, then (with autoplay on) what
// Harmoni lined up. Used full screen in Now Playing and docked beside the
// page. `lead` goes above it, inside the same scroller.
export function Queue({ className, lead }: { className?: string; lead?: ReactNode }) {
  const player = usePlayer();
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const toast = useToast();
  const upcoming = player.queue.slice(player.index + 1).map((song, i) => ({ song, index: player.index + 1 + i }));
  const yours = upcoming.filter((q) => !q.song.autoplay);
  const suggested = upcoming.filter((q) => q.song.autoplay);
  const on = !!user?.autoplay;
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <div className={`${styles.queue} ${className ?? ""}`} ref={scroller}>
      {lead}
      <p className={styles.queueHeading}>{yours.length ? "Up next" : "Nothing queued after this one."}</p>
      <QueueList items={yours} scroller={scroller} />
      <div className={styles.autoplay}>
        <span className={styles.autoplayText}>
          <span className={styles.queueHeading}>Autoplay</span>
          <span className={styles.queueArtist}>{on ? "Similar songs keep playing when your queue ends." : "Turn on to keep playing similar songs when your queue ends."}</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Autoplay"
          className={styles.autoplaySwitch}
          onClick={() => updatePreferences({ autoplay: !on }).catch(() => toast("Couldn't change autoplay.", "error"))}
        />
      </div>
      {on && <QueueList items={suggested} scroller={scroller} />}
    </div>
  );
}

// Songs in one part of the queue (yours, or autoplay's), dragged by the
// handle to reorder them within it.
function QueueList({ items, scroller }: { items: { song: QueueSong; index: number }[]; scroller: React.RefObject<HTMLDivElement | null> }) {
  const player = usePlayer();
  const contextMenu = useContextMenu();
  const songMenu = useSongMenu();
  // Stable across moves, so a dragged row keeps its element (and focus).
  const seen = new Map<string, number>();
  const keys = items.map(({ song }) => {
    const n = seen.get(song.id) ?? 0;
    seen.set(song.id, n + 1);
    return `${song.id}-${n}`;
  });
  const list = useRef<HTMLOListElement>(null);
  const reorder = useReorder({
    keys,
    onMove: (from, to) => player.moveInQueue(items[from].index, items[to].index),
    list: () => list.current,
    scroller: () => scroller.current,
  });
  if (!items.length) return null;
  return (
    <ol className={`${styles.queueList} ${reorder.active ? styles.queueListDragging : ""}`} ref={list}>
      {items.map(({ song, index }, i) => {
        const row = reorder.row(i);
        return (
          <li
            key={keys[i]}
            className={`${styles.queueItem} ${row.dragging ? styles.queueItemDragging : ""}`}
            style={row.style}
            onClick={() => player.jumpTo(index)}
            onContextMenu={(e) =>
              contextMenu(
                e,
                () =>
                  songMenu(song, [
                    { label: "Play now", icon: "play", onSelect: () => player.jumpTo(index) },
                    { label: "Remove from queue", icon: "close", onSelect: () => player.removeFromQueue(index) },
                  ], { queue: true }),
                { sheetHeader: <SongMenuHeader song={song} /> },
              )
            }
          >
            <Artwork src={song.artworkUrl} size={48} radius="sm" />
            <span className={styles.queueText}>
              <span className={styles.queueTitle}>{song.title}</span>
              <span className={styles.queueArtist}>{song.artists.map((a) => a.name).join(", ")}</span>
            </span>
            <IconButton
              icon="close"
              label={`Remove ${song.title} from queue`}
              className={styles.chromeButton}
              onClick={(e) => {
                e.stopPropagation();
                player.removeFromQueue(index);
              }}
            />
            <button type="button" className={`${styles.chromeButton} ${styles.grip}`} aria-label={`Move ${song.title} (drag, or use the arrow keys)`} {...reorder.handle} data-reorder={i}>
              <Icon name="grip" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
