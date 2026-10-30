"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { useLibrary } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences, useUser } from "@/components/providers/user";
import { ArtistLinks } from "@/components/song/song-list";
import { Artwork, IconButton } from "@/components/ui";
import { loadLyrics } from "@/lib/lyrics-cache";
import { useArtworkTheme, type ArtworkTheme } from "@/lib/artwork-theme";
import { useMediaQuery } from "@/lib/use-media-query";
import type { LyricsResponse } from "@/server/lyrics/service";
import { ImmersiveLyrics, PlainLyrics } from "./lyrics/immersive-lyrics";
import styles from "./now-playing.module.css";
import { Controls, Progress, Volume } from "./player-bar";
import { usePlayer, type QueueSong } from "./player";
import { useReorder } from "./reorder";

// "art" is the plain player: big artwork and controls, nothing beside it.
type Tab = "art" | "lyrics" | "queue";

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
  const isOpen = tab !== undefined;
  const lastTab = useRef<Tab>("art");
  useEffect(() => {
    if (tab) lastTab.current = tab;
  }, [tab]);

  // The sheet gets its own history entry, so the back gesture (and
  // Android's back button) closes it instead of leaving the page.
  useEffect(() => {
    if (isOpen && !window.history.state?.nowPlaying) window.history.pushState({ ...window.history.state, nowPlaying: true }, "");
  }, [isOpen]);

  // Back and forward show or hide the sheet to match the entry, so going
  // back from a page opened out of Now Playing lands in Now Playing again.
  useEffect(() => {
    const onPop = () => setTab(window.history.state?.nowPlaying ? lastTab.current : undefined);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Closing pops that entry; the popstate above does the rest.
  const close = useCallback(() => {
    if (window.history.state?.nowPlaying) window.history.back();
    else setTab(undefined);
  }, []);
  // Links out of the sheet (artist, album) close it once the page changes.
  // Closing on the click itself would unmount the link before Next sees the
  // click, and the browser would do a full page load, stopping the music.
  // Going back onto the sheet's own entry is the one page change that keeps it.
  const leave = useCallback(() => {
    if (!window.history.state?.nowPlaying) setTab(undefined);
  }, []);

  const value = useMemo<NowPlayingApi>(
    () => ({ tab, open: setTab, toggle: (t) => (tab === t ? close() : setTab(t)), close }),
    [tab, close],
  );
  return (
    <NowPlayingContext value={value}>
      {children}
      <Suspense fallback={null}>
        <OnNavigate onNavigate={leave} />
      </Suspense>
      {tab && <NowPlayingSheet tab={tab} setTab={setTab} onClose={close} />}
    </NowPlayingContext>
  );
}

function OnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => {
    if (pathname === last.current) return;
    last.current = pathname;
    onNavigate();
  }, [pathname, onNavigate]);
  return null;
}

// Hide the chrome (close, tabs, transport) after a few still seconds so the
// lyrics and artwork get the whole screen; any movement brings it back.
const IDLE_MS = 3000;
// Pulling the sheet down this far (or flicking it) closes it.
const DISMISS_PX = 140;
const DISMISS_SPEED = 0.6; // px per ms
const OUT_MS = 280;

function NowPlayingSheet({ tab, setTab, onClose }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const player = usePlayer();
  const song = player.current;
  const theme = useArtworkTheme(song?.id);
  const { settings } = useSettings();
  const library = useLibrary();
  const lyrics = useLyrics(song?.id);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Phones and portrait tablets: stacked layout, grabber, swipe down to close.
  const narrow = useMediaQuery("(max-width: 900px)");
  const sheet = useRef<HTMLDivElement>(null);
  const pull = useRef<{ y: number; t: number; id: number; dy: number }>(undefined);

  // Slides away before unmounting, the way it came in.
  const dismiss = useCallback(() => {
    const el = sheet.current;
    if (!el) return onClose();
    el.style.transition = `transform ${OUT_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${OUT_MS}ms ease-in`;
    el.style.transform = "translateY(100%)";
    if (!narrow) el.style.opacity = "0";
    setTimeout(onClose, OUT_MS - 20);
  }, [onClose, narrow]);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      else wake();
    };
    window.addEventListener("keydown", onKey);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(idleTimer.current);
    };
  }, [dismiss, wake]);

  useEffect(() => {
    if (!song) onClose();
  }, [song, onClose]);
  if (!song) return null;

  const synced = typeof lyrics === "object" && lyrics.found && (lyrics.sync === "line" || lyrics.sync === "word");
  const hasWords = typeof lyrics === "object" && lyrics.found && !lyrics.instrumental && lyrics.lines.length > 0;
  // With no words to show, the artwork takes centre stage instead.
  const mode = tab === "queue" ? "queue" : tab === "art" ? "art" : lyrics === "loading" || hasWords ? "lyrics" : "art";
  // On a phone the plain player is where your thumb works the controls;
  // only lyrics get the room to themselves.
  const canIdle = player.playing && !(narrow && mode !== "lyrics");

  const settle = (e: React.PointerEvent) => {
    const p = pull.current;
    const el = sheet.current;
    pull.current = undefined;
    if (!p || p.id !== e.pointerId || !el) return;
    const speed = p.dy / Math.max(1, e.timeStamp - p.t);
    if (p.dy > DISMISS_PX || (p.dy > 40 && speed > DISMISS_SPEED)) return dismiss();
    el.style.transition = "transform 420ms cubic-bezier(0.2, 0.9, 0.25, 1.05)";
    el.style.transform = "";
  };

  return (
    <div
      ref={sheet}
      className={styles.sheet}
      data-mode={mode}
      data-playing={player.playing || undefined}
      data-idle={(idle && canIdle) || undefined}
      onPointerMove={(e) => {
        wake();
        const p = pull.current;
        if (!p || p.id !== e.pointerId || !sheet.current) return;
        p.dy = Math.max(0, e.clientY - p.y);
        // Past a small dead zone the sheet follows the finger.
        if (p.dy > 6) {
          sheet.current.style.transition = "none";
          sheet.current.style.transform = `translateY(${p.dy}px)`;
        }
      }}
      onPointerDown={(e) => {
        wake();
        // Lyrics and the queue scroll by touch, and sliders drag: those keep their gestures.
        if (!narrow || e.pointerType !== "touch" || (e.target as HTMLElement).closest(`input, .${styles.panel}`)) return;
        pull.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId, dy: 0 };
      }}
      onPointerUp={settle}
      onPointerCancel={settle}
      role="dialog"
      aria-label="Now Playing"
    >
      <Backdrop songId={song.id} theme={theme} />

      <header className={`${styles.chrome} ${styles.topbar}`}>
        <div className={styles.pill}>
          <IconButton icon="caret-down" label="Close Now Playing" onClick={dismiss} className={styles.chromeButton} />
        </div>
        {/* Phones: a grabber instead, which you can also tap. */}
        <button type="button" className={styles.grabber} onClick={dismiss} aria-label="Close Now Playing" />
      </header>

      {/* Phones, with lyrics or the queue up: the song shrinks to a header. */}
      <div className={styles.compact}>
        <Artwork src={song.artworkUrl} alt="" size={56} radius="sm" className={styles.compactArt} />
        <div className={styles.metaText}>
          <p className={styles.title}>{song.title}</p>
          <p className={styles.artist}>{song.artists.map((a) => a.name).join(", ")}</p>
        </div>
        <IconButton
          icon={library.isLiked(song.id) ? "heart-solid" : "heart"}
          label={library.isLiked(song.id) ? "Remove from Liked" : "Add to Liked"}
          pressed={library.isLiked(song.id)}
          onClick={() => library.toggleLike(song)}
          className={styles.chromeButton}
        />
      </div>

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
                    <Link href={`/album/${song.album.id}`}>
                      {song.album.title}
                    </Link>
                  </>
                )}
              </p>
              {mode === "art" && typeof lyrics === "object" && !hasWords && (
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
          {/* Picking the open view again goes back to the plain player. */}
          <IconButton icon="lyrics" label="Lyrics" pressed={mode === "lyrics"} onClick={() => setTab(mode === "lyrics" ? "art" : "lyrics")} className={styles.chromeButton} />
          <IconButton icon="queue" label="Up next" pressed={mode === "queue"} onClick={() => setTab(mode === "queue" ? "art" : "queue")} className={styles.chromeButton} />
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
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const toast = useToast();
  const upcoming = player.queue.slice(player.index + 1).map((song, i) => ({ song, index: player.index + 1 + i }));
  const yours = upcoming.filter((q) => !q.song.autoplay);
  const suggested = upcoming.filter((q) => q.song.autoplay);
  const on = !!user?.autoplay;
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <div className={styles.queue} ref={scroller}>
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
