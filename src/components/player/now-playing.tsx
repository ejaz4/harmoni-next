"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLibrary } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { ArtistLinks } from "@/components/song/song-list";
import { Artwork, IconButton } from "@/components/ui";
import { loadLyrics } from "@/lib/lyrics-cache";
import { useArtworkTheme, type ArtworkTheme } from "@/lib/artwork-theme";
import type { LyricsResponse } from "@/server/lyrics/service";
import { ImmersiveLyrics, PlainLyrics } from "./lyrics/immersive-lyrics";
import styles from "./now-playing.module.css";
import { Controls, Progress, Volume } from "./player-bar";
import { usePlayer } from "./player";

type Tab = "lyrics" | "queue";

interface NowPlayingApi {
  tab?: Tab; // undefined when closed
  open(tab: Tab): void;
  toggle(tab: Tab): void;
  close(): void;
}

const NowPlayingContext = createContext<NowPlayingApi>({ open() {}, toggle() {}, close() {} });

export function useNowPlaying() {
  return useContext(NowPlayingContext);
}

export function NowPlayingProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>();
  const close = useCallback(() => setTab(undefined), []);
  const value = useMemo<NowPlayingApi>(
    () => ({ tab, open: setTab, toggle: (t) => setTab((cur) => (cur === t ? undefined : t)), close }),
    [tab, close],
  );
  return (
    <NowPlayingContext value={value}>
      {children}
      {tab && <NowPlayingSheet tab={tab} setTab={setTab} onClose={close} />}
    </NowPlayingContext>
  );
}

// Hide the chrome (close, tabs, transport) after a few still seconds so the
// lyrics and artwork get the whole screen; any movement brings it back.
const IDLE_MS = 3000;

function NowPlayingSheet({ tab, setTab, onClose }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const player = usePlayer();
  const song = player.current;
  const theme = useArtworkTheme(song?.id);
  const { settings } = useSettings();
  const library = useLibrary();
  const lyrics = useLyrics(song?.id);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else wake();
    };
    window.addEventListener("keydown", onKey);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(idleTimer.current);
    };
  }, [onClose, wake]);

  useEffect(() => {
    if (!song) onClose();
  }, [song, onClose]);
  if (!song) return null;

  const synced = typeof lyrics === "object" && lyrics.found && (lyrics.sync === "line" || lyrics.sync === "word");
  const hasWords = typeof lyrics === "object" && lyrics.found && !lyrics.instrumental && lyrics.lines.length > 0;
  // With no words to show, the artwork takes centre stage instead.
  const mode = tab === "queue" ? "queue" : lyrics === "loading" || hasWords ? "lyrics" : "art";

  return (
    <div
      className={styles.sheet}
      data-idle={(idle && player.playing) || undefined}
      onPointerMove={wake}
      onPointerDown={wake}
      role="dialog"
      aria-label="Now Playing"
    >
      <Backdrop songId={song.id} theme={theme} />

      <header className={`${styles.chrome} ${styles.topbar}`}>
        <div className={styles.pill}>
          <IconButton icon="caret-down" label="Close Now Playing" onClick={onClose} className={styles.chromeButton} />
        </div>
      </header>

      <div className={styles.layout} data-mode={mode}>
        <div className={styles.stage}>
          <Artwork src={song.artworkUrl} alt={`${song.title} cover`} radius="sm" className={styles.art} />
          <div className={styles.meta}>
            <div className={styles.metaText}>
              <h1 className={styles.title}>{song.title}</h1>
              <p className={styles.artist}>
                <ArtistLinks artists={song.artists} />
                {song.album?.id && (
                  <>
                    {" · "}
                    <Link href={`/album/${song.album.id}`} onClick={onClose}>
                      {song.album.title}
                    </Link>
                  </>
                )}
              </p>
              {mode === "art" && typeof lyrics === "object" && (
                <p className={styles.quietNote}>{lyrics.instrumental ? "Instrumental" : "No lyrics for this one"}</p>
              )}
            </div>
            <IconButton
              icon={library.isLiked(song.id) ? "heart-solid" : "heart"}
              label={library.isLiked(song.id) ? "Remove from Liked" : "Add to Liked"}
              pressed={library.isLiked(song.id)}
              onClick={() => library.toggleLike(song)}
              className={`${styles.chromeButton} ${styles.metaLike}`}
            />
          </div>
          {/* Stays visible when idle; moves above the title like Cider. */}
          <Progress className={styles.progress} />
          {/* Folds away when idle, so the artwork glides back to centre. */}
          <div className={styles.collapse}>
            <div className={`${styles.chrome} ${styles.transport}`}>
              <Controls className={styles.controls} playClass={styles.play} />
              <Volume className={styles.volume} />
              {settings.developerMode && <Provenance songId={song.id} lyrics={lyrics} />}
            </div>
          </div>
        </div>

        {mode !== "art" && (
          <section className={styles.panel}>
            {mode === "queue" ? (
              <Queue />
            ) : lyrics === "loading" ? null : lyrics === "error" ? (
              <p className={styles.quietNote}>Couldn&apos;t load lyrics right now.</p>
            ) : synced ? (
              <ImmersiveLyrics key={song.id} lines={lyrics.lines} durationMs={song.durationMs} onSeek={(ms) => player.seek(ms / 1000)} />
            ) : (
              <PlainLyrics lines={lyrics.lines} />
            )}
          </section>
        )}
      </div>

      <nav className={`${styles.chrome} ${styles.views}`} aria-label="Now Playing views">
        <div className={styles.pill} role="tablist">
          <IconButton icon="queue" label="Up next" pressed={tab === "queue"} onClick={() => setTab("queue")} className={styles.chromeButton} />
          <IconButton icon="lyrics" label="Lyrics" pressed={tab === "lyrics"} onClick={() => setTab("lyrics")} className={styles.chromeButton} />
        </div>
      </nav>
    </div>
  );
}

// The cover, blurred and saturated into a slowly drifting wash. Each song
// fades in over the last one.
function Backdrop({ songId, theme }: { songId: string; theme?: ArtworkTheme }) {
  const [layers, setLayers] = useState<string[]>([songId]);
  if (layers.at(-1) !== songId) setLayers([...layers.slice(-1), songId]);
  return (
    <div className={styles.backdrop} style={{ "--np-color": theme?.color } as React.CSSProperties} aria-hidden>
      {layers.map((id) => (
        <div key={id} className={styles.layer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.blob} src={`/api/songs/${id}/artwork`} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.blob} src={`/api/songs/${id}/artwork`} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.blob} src={`/api/songs/${id}/artwork`} alt="" />
        </div>
      ))}
      <div className={styles.veil} data-light={theme?.light || undefined} />
    </div>
  );
}

function useLyrics(songId?: string): LyricsResponse | "loading" | "error" {
  const [state, setState] = useState<{ id: string; value: LyricsResponse | "error" }>();
  useEffect(() => {
    if (!songId) return;
    let live = true;
    loadLyrics(songId).then(
      (value) => live && setState({ id: songId, value }),
      () => live && setState({ id: songId, value: "error" }),
    );
    return () => {
      live = false;
    };
  }, [songId]);
  return state && state.id === songId ? state.value : "loading";
}

function Queue() {
  const player = usePlayer();
  const upcoming = player.queue.slice(player.index + 1);
  return (
    <div className={styles.queue}>
      <p className={styles.queueHeading}>{upcoming.length ? "Up next" : "Nothing queued after this one."}</p>
      <ol className={styles.queueList}>
        {upcoming.map((song, i) => {
          const index = player.index + 1 + i;
          return (
            <li key={`${song.id}-${index}`} className={styles.queueItem} onClick={() => player.jumpTo(index)}>
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
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const PROVIDER_NAMES: Record<string, string> = {
  ytm: "YouTube Music",
  deezer: "Deezer",
  itunes: "iTunes",
  tidal: "TIDAL",
  mb: "MusicBrainz",
  lrclib: "LRCLIB",
  spotify: "Spotify",
};

// Developer mode only: where this song's audio and lyrics actually came from.
function Provenance({ songId, lyrics }: { songId: string; lyrics: LyricsResponse | "loading" | "error" }) {
  const [source, setSource] = useState<{ id: string; value: string }>();
  useEffect(() => {
    let live = true;
    // The audio element can't read response headers, so ask for one byte.
    fetch(`/api/play/${songId}`, { headers: { Range: "bytes=0-0" } })
      .then((r) => live && setSource({ id: songId, value: r.headers.get("x-harmoni-source") ?? "unknown" }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [songId]);

  const describe = (s: string) => {
    const cached = s.match(/^cache \((.+)\)$/);
    const uri = cached ? cached[1] : s;
    const provider = uri.split(":")[0];
    return `${PROVIDER_NAMES[provider] ?? provider}${cached ? " (cached)" : ""} · ${uri}`;
  };
  const lyricsSource = typeof lyrics === "object" && lyrics.found ? `${PROVIDER_NAMES[lyrics.provider ?? ""] ?? lyrics.provider} (${lyrics.sync})` : "none";

  return (
    <p className={styles.provenance}>
      Audio: {source?.id === songId ? describe(source.value) : "…"}
      <br />
      Lyrics: {lyricsSource}
    </p>
  );
}
