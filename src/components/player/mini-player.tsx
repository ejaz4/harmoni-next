"use client";

import { useRef } from "react";
import { Icon } from "@/components/icon";
import { Artwork, ui } from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";
import { useArtworkTheme } from "@/lib/artwork-theme";
import { useNowPlaying } from "./now-playing";
import { usePlayer, usePlayhead } from "./player";
import styles from "./mini-player.module.css";

// How far a finger has to travel before a touch counts as a swipe.
const SWIPE_PX = 48;

// The phone's player: a floating card above the tab bar. Tap or swipe up
// to open Now Playing; swipe sideways to skip.
export function MiniPlayer() {
  const player = usePlayer();
  const nowPlaying = useNowPlaying();
  const song = player.current;
  const theme = useArtworkTheme(song?.id);
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; swiped: boolean }>(undefined);

  if (!song) return null;

  const move = (dx: number) => {
    if (card.current) card.current.style.setProperty("--drag", `${dx}px`);
  };

  return (
    <div
      ref={card}
      className={styles.mini}
      data-mini
      style={{ "--mini-color": theme?.color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`Now playing: ${song.title}. Open player`}
      onClick={() => {
        if (drag.current?.swiped) return;
        nowPlaying.open("art");
      }}
      onKeyDown={(e) => e.key === "Enter" && nowPlaying.open("art")}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiped: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        // Follows the finger sideways, with resistance, as a hint of what's coming.
        if (Math.abs(dx) > Math.abs(e.clientY - d.y)) move(dx * 0.35);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        move(0);
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (dy < -SWIPE_PX && Math.abs(dy) > Math.abs(dx)) {
          d.swiped = true;
          nowPlaying.open("art");
        } else if (Math.abs(dx) > SWIPE_PX * 1.5 && Math.abs(dx) > Math.abs(dy)) {
          d.swiped = true;
          if (dx < 0) player.next();
          else player.prev();
        }
      }}
      onPointerCancel={() => {
        move(0);
        drag.current = undefined;
      }}
    >
      <div className={styles.content}>
        <Artwork src={song.artworkUrl} size={42} radius="sm" className={styles.art} />
        <span className={styles.titles}>
          <span className={styles.title}>{song.title}</span>
          <span className={styles.artist}>{song.artists.map((a) => a.name).join(", ")}</span>
        </span>
      </div>
      <button
        type="button"
        className={`${ui.iconButton} ${styles.button} ${styles.play}`}
        onClick={(e) => {
          e.stopPropagation();
          player.toggle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={player.buffering ? "Loading" : player.playing ? "Pause" : "Play"}
      >
        {player.buffering ? <Spinner /> : <Icon name={player.playing ? "pause" : "play"} />}
      </button>
      <button
        type="button"
        className={`${ui.iconButton} ${styles.button}`}
        onClick={(e) => {
          e.stopPropagation();
          player.next();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Next"
      >
        <Icon name="next" />
      </button>
      <Line />
    </div>
  );
}

// A hairline of progress along the bottom of the card.
function Line() {
  const player = usePlayer();
  const { time, duration } = usePlayhead();
  const total = duration || (player.current?.durationMs ?? 0) / 1000;
  return <span className={styles.line} style={{ "--p": total ? time / total : 0 } as React.CSSProperties} aria-hidden />;
}
