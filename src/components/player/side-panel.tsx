"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SongMenuHeader, useSongMenu } from "@/components/song/song-menu";
import { LikeButton } from "@/components/song/like-button";
import { ArtistLinks } from "@/components/song/song-list";
import { Artwork, IconButton, useContextMenu } from "@/components/ui";
import { useArtworkTheme } from "@/lib/artwork-theme";
import { ImmersiveLyrics, PlainLyrics } from "./lyrics/immersive-lyrics";
import { Backdrop, useLyrics, useNowPlaying } from "./now-playing";
import npStyles from "./now-playing.module.css";
import { usePlayer } from "./player";
import { Queue } from "./queue";
import styles from "./side-panel.module.css";

// The Now Playing panel docked beside the page on desktop: what's up next,
// or the lyrics, without leaving what you're looking at. Full screen Now
// Playing is still a click away.

export type PanelView = "queue" | "lyrics";

interface SidePanelApi {
  view?: PanelView; // undefined when closed
  toggle(view: PanelView): void;
  close(): void;
}

const SidePanelContext = createContext<SidePanelApi>({ toggle() {}, close() {} });

export function useSidePanel() {
  return useContext(SidePanelContext);
}

const STORAGE_KEY = "harmoni:panel";

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<PanelView>();
  // Opens the way you left it (after mounting: the server can't know).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved preference once
      if (saved === "queue" || saved === "lyrics") setView(saved);
    } catch {}
  }, []);
  const save = useCallback((next?: PanelView) => {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ?? "");
    } catch {}
  }, []);
  const value = useMemo<SidePanelApi>(() => ({ view, toggle: (v) => save(view === v ? undefined : v), close: () => save(undefined) }), [view, save]);
  return <SidePanelContext value={value}>{children}</SidePanelContext>;
}

export function SidePanel() {
  const panel = useSidePanel();
  const nowPlaying = useNowPlaying();
  // The last view stays drawn while the panel slides shut.
  const [shown, setShown] = useState<PanelView>("queue");
  if (panel.view && panel.view !== shown) setShown(panel.view);

  return (
    <aside className={styles.panel} data-open={panel.view ? true : undefined} aria-label="Now Playing" aria-hidden={!panel.view} inert={!panel.view}>
      <div className={styles.inner} data-view={shown}>
        <header className={styles.head}>
          <div className={styles.tabs} role="tablist" data-at={shown}>
            <span className={styles.tabIndicator} aria-hidden />
            <button type="button" role="tab" className={styles.tab} aria-selected={shown === "queue"} onClick={() => shown !== "queue" && panel.toggle("queue")}>
              Up next
            </button>
            <button type="button" role="tab" className={styles.tab} aria-selected={shown === "lyrics"} onClick={() => shown !== "lyrics" && panel.toggle("lyrics")}>
              Lyrics
            </button>
          </div>
          <IconButton icon="expand" label="Full screen" className={styles.headButton} onClick={() => nowPlaying.open(shown)} />
          <IconButton icon="close" label="Close panel" className={styles.headButton} onClick={panel.close} />
        </header>
        <div className={styles.body} key={shown}>
          {shown === "queue" ? <QueueView /> : <LyricsView />}
        </div>
      </div>
    </aside>
  );
}

function QueueView() {
  const player = usePlayer();
  const song = player.current;
  const contextMenu = useContextMenu();
  const songMenu = useSongMenu();
  const nowPlaying = useNowPlaying();
  if (!song) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Nothing playing</p>
        <p className={styles.emptyBody}>Play a song and what&apos;s coming up next shows here. Drag to reorder it.</p>
      </div>
    );
  }
  return (
    <Queue
      className={styles.queue}
      lead={
        <div className={styles.current} onContextMenu={(e) => contextMenu(e, () => songMenu(song), { sheetHeader: <SongMenuHeader song={song} /> })}>
          <p className={styles.kicker}>Now playing</p>
          <div className={styles.currentRow}>
            <button type="button" className={styles.currentArt} onClick={() => nowPlaying.open("art")} aria-label="Open Now Playing">
              <Artwork src={song.artworkUrl} size={64} radius="sm" />
            </button>
            <div className={styles.currentText}>
              <span className={styles.currentTitle}>{song.title}</span>
              <span className={styles.currentArtist}>
                <ArtistLinks artists={song.artists} />
              </span>
            </div>
            <LikeButton song={song} />
          </div>
        </div>
      }
    />
  );
}

function LyricsView() {
  const player = usePlayer();
  const song = player.current;
  const theme = useArtworkTheme(song?.id);
  const lyrics = useLyrics(song?.id);
  if (!song) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Nothing playing</p>
        <p className={styles.emptyBody}>Play a song and its lyrics show here, in time with the music.</p>
      </div>
    );
  }
  const found = typeof lyrics === "object" && lyrics.found && !lyrics.instrumental && lyrics.lines.length > 0 ? lyrics : undefined;
  const synced = found && (found.sync === "line" || found.sync === "word");
  return (
    <div className={styles.lyrics}>
      <Backdrop songId={song.id} theme={theme} compact />
      <div className={styles.lyricsBody}>
        {lyrics === "loading" ? (
          <div className={styles.lyricsLoading} aria-busy="true" aria-label="Loading lyrics">
            {[72, 54, 86, 40].map((w, i) => (
              <span key={i} style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : found && synced ? (
          <ImmersiveLyrics key={song.id} lines={found.lines} durationMs={song.durationMs} onSeek={(ms) => player.seek(ms / 1000)} />
        ) : found ? (
          <PlainLyrics lines={found.lines} />
        ) : (
          <div className={styles.noLyrics}>
            <Artwork src={song.artworkUrl} size={120} radius="md" className={styles.noLyricsArt} />
            <p className={styles.noLyricsTitle}>{lyrics === "error" ? "Couldn't load lyrics" : typeof lyrics === "object" && lyrics.instrumental ? "Instrumental" : "No lyrics for this one"}</p>
            <p className={npStyles.quietNote}>
              {lyrics === "error" ? "Try again in a moment." : (
                <>
                  {song.title} · <Link href={song.artists[0]?.id ? `/artist/${song.artists[0].id}` : "#"}>{song.artists[0]?.name}</Link>
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
