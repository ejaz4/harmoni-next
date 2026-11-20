"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { LikeButton } from "@/components/song/like-button";
import { SongMenuHeader, useSongMenu } from "@/components/song/song-menu";
import { ArtistLinks } from "@/components/song/song-list";
import { Artwork, IconButton, ui, useContextMenu } from "@/components/ui";
import { useMediaQuery } from "@/lib/use-media-query";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration } from "@/lib/format";
import { LinkButton } from "./link-button";
import { useNowPlaying } from "./now-playing";
import { usePlayer, usePlayhead } from "./player";
import { useSidePanel } from "./side-panel";
import styles from "./player.module.css";

export function PlayerBar() {
  const player = usePlayer();
  const nowPlaying = useNowPlaying();
  const panel = useSidePanel();
  const contextMenu = useContextMenu();
  const songMenu = useSongMenu();
  const song = player.current;
  // Lyrics and the queue dock beside the page where there's room for them;
  // narrower screens open them full screen.
  const docks = useMediaQuery("(min-width: 901px)");
  const show = (view: "lyrics" | "queue") => (docks ? panel.toggle(view) : nowPlaying.toggle(view));
  const showing = (view: "lyrics" | "queue") => (docks ? panel.view === view : nowPlaying.tab === view);

  return (
    <footer className={styles.bar} aria-label="Player">
      <div
        className={styles.nowPlaying}
        onContextMenu={song ? (e) => contextMenu(e, () => songMenu(song), { sheetHeader: <SongMenuHeader song={song} /> }) : undefined}
      >
        {song ? (
          <>
            <button type="button" className={styles.barArt} onClick={() => nowPlaying.open("art")} aria-label="Open Now Playing" title="Open Now Playing">
              <Artwork src={song.artworkUrl} size={56} radius="sm" key={song.id} className={styles.barArtImage} />
              <span className={styles.barArtExpand} aria-hidden>
                <Icon name="caret-down" />
              </span>
            </button>
            <span className={styles.barTitles} key={song.id}>
              <button type="button" className={styles.barTitle} onClick={() => nowPlaying.open("art")}>
                {song.title}
              </button>
              <span className={styles.barArtist}>
                <ArtistLinks artists={song.artists} />
              </span>
            </span>
            <LikeButton song={song} className={styles.barLike} />
          </>
        ) : (
          <span className={styles.idle}>Pick something to play.</span>
        )}
      </div>

      <div className={styles.center}>
        <Controls />
        {player.error ? <span className={styles.error}>{player.error}</span> : <Progress />}
      </div>

      <div className={styles.right}>
        <IconButton icon="lyrics" label="Lyrics" onClick={() => show("lyrics")} pressed={showing("lyrics")} disabled={!song} />
        <IconButton icon="queue" label="Up next" onClick={() => show("queue")} pressed={showing("queue")} disabled={!song} />
        <LinkButton up />
        <Volume />
        <IconButton icon="expand" label="Full screen" onClick={() => nowPlaying.open("art")} disabled={!song} />
      </div>
    </footer>
  );
}

export function Controls({ className, playClass }: { className?: string; playClass?: string }) {
  const player = usePlayer();
  const none = !player.current;
  return (
    <div className={`${styles.controls} ${className ?? ""}`}>
      <IconButton
        icon="shuffle"
        label={player.shuffle ? "Shuffle on" : "Shuffle"}
        pressed={player.shuffle}
        onClick={() => player.setShuffle(!player.shuffle)}
        className={styles.toggle}
      />
      <IconButton icon="prev" label="Previous" onClick={player.prev} disabled={none} className={styles.skip} />
      <button
        type="button"
        className={`${ui.iconButton} ${styles.main} ${playClass ?? ""}`}
        onClick={player.toggle}
        disabled={none}
        aria-label={player.buffering ? "Loading" : player.playing ? "Pause" : "Play"}
        title={player.buffering ? "Loading" : player.playing ? "Pause" : "Play"}
      >
        {player.buffering ? (
          <Spinner className={styles.spinner} />
        ) : (
          <span className={styles.glyphs} data-playing={player.playing || undefined}>
            <Icon name="play" className={styles.playGlyph} />
            <Icon name="pause" className={styles.pauseGlyph} />
          </span>
        )}
      </button>
      <IconButton icon="next" label="Next" onClick={player.next} disabled={none} className={styles.skip} />
      <button
        type="button"
        className={`${ui.iconButton} ${styles.toggle}`}
        onClick={player.cycleRepeat}
        aria-pressed={player.repeat !== "off"}
        aria-label={player.repeat === "one" ? "Repeating this song" : player.repeat === "all" ? "Repeating all" : "Repeat"}
        title={player.repeat === "one" ? "Repeating this song" : player.repeat === "all" ? "Repeating all" : "Repeat"}
      >
        <Icon name="repeat" />
        {player.repeat === "one" && <span className={styles.repeatOne}>1</span>}
      </button>
    </div>
  );
}

export function Progress({ className }: { className?: string }) {
  const player = usePlayer();
  const { time, duration } = usePlayhead();
  const [scrub, setScrub] = useState<number>();
  const shown = scrub ?? time;
  const total = duration || (player.current?.durationMs ?? 0) / 1000;
  const fill = total ? `${(shown / total) * 100}%` : "0%";
  return (
    <div className={`${styles.progressRow} ${className ?? ""}`}>
      <span className="tabular">{formatDuration(shown * 1000)}</span>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={total || 1}
        step={0.1}
        value={Math.min(shown, total || 1)}
        style={{ "--fill": fill } as React.CSSProperties}
        aria-label="Seek"
        disabled={!player.current}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub !== undefined) player.seek(scrub);
          setScrub(undefined);
        }}
        onKeyUp={() => {
          if (scrub !== undefined) player.seek(scrub);
          setScrub(undefined);
        }}
      />
      <span className="tabular">{formatDuration(total * 1000)}</span>
    </div>
  );
}

export function Volume({ className }: { className?: string }) {
  const player = usePlayer();
  const level = player.muted ? 0 : player.volume;
  const icon = level === 0 ? "volume-off" : level < 0.5 ? "volume-down" : "volume-up";
  return (
    <div className={`${styles.volumeRow} ${className ?? ""}`}>
      <IconButton icon={icon} label={player.muted ? "Unmute" : "Mute"} onClick={() => player.setMuted(!player.muted)} />
      <input
        type="range"
        className={`${styles.slider} ${styles.volume}`}
        min={0}
        max={1}
        step={0.01}
        value={level}
        style={{ "--fill": `${level * 100}%` } as React.CSSProperties}
        aria-label="Volume"
        onChange={(e) => player.setVolume(Number(e.target.value))}
      />
    </div>
  );
}

// Re-exported for Now Playing's stage.
export { ArtistLinks };
