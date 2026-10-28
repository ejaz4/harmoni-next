"use client";

import { useState } from "react";
import { ArtistLinks } from "@/components/song/song-list";
import { useLibrary } from "@/components/providers/library";
import { Icon } from "@/components/icon";
import { Artwork, IconButton, ui } from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";
import { formatDuration } from "@/lib/format";
import { useNowPlaying } from "./now-playing";
import { usePlayer, usePlayhead } from "./player";
import styles from "./player.module.css";

export function PlayerBar() {
  const player = usePlayer();
  const library = useLibrary();
  const nowPlaying = useNowPlaying();
  const song = player.current;

  return (
    <footer className={styles.bar} aria-label="Player">
      <div className={styles.nowPlaying}>
        {song ? (
          <>
            <button type="button" className={styles.nowPlayingButton} onClick={() => nowPlaying.open("lyrics")} aria-label="Open Now Playing">
              <Artwork src={song.artworkUrl} size={52} radius="sm" />
              <span className={styles.barTitles}>
                <span className={styles.barTitle}>{song.title}</span>
                <span className={styles.barArtist}>{song.artists.map((a) => a.name).join(", ")}</span>
              </span>
            </button>
            <IconButton
              icon={library.isLiked(song.id) ? "heart-solid" : "heart"}
              label={library.isLiked(song.id) ? "Remove from Liked" : "Add to Liked"}
              pressed={library.isLiked(song.id)}
              onClick={() => library.toggleLike(song)}
            />
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
        <IconButton icon="lyrics" label="Lyrics" onClick={() => nowPlaying.toggle("lyrics")} pressed={nowPlaying.tab === "lyrics"} disabled={!song} />
        <IconButton icon="queue" label="Up next" onClick={() => nowPlaying.toggle("queue")} pressed={nowPlaying.tab === "queue"} disabled={!song} />
        <Volume />
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
        {player.buffering ? <Spinner className={styles.spinner} /> : <Icon name={player.playing ? "pause" : "play"} />}
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
