"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/components/providers/settings";
import { ArtistLinks } from "@/components/song/song-list";
import { Artwork, IconButton } from "@/components/ui";
import { api } from "@/lib/api";
import { useArtworkTheme } from "@/lib/artwork-theme";
import type { LyricsResponse } from "@/server/lyrics/service";
import { Controls, Progress } from "./player-bar";
import { usePlayer, usePlayhead } from "./player";
import styles from "./player.module.css";

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
  const value = useMemo<NowPlayingApi>(
    () => ({
      tab,
      open: setTab,
      toggle: (t) => setTab((cur) => (cur === t ? undefined : t)),
      close: () => setTab(undefined),
    }),
    [tab],
  );
  return (
    <NowPlayingContext value={value}>
      {children}
      {tab && <NowPlayingSheet tab={tab} setTab={setTab} onClose={() => setTab(undefined)} />}
    </NowPlayingContext>
  );
}

function NowPlayingSheet({ tab, setTab, onClose }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const player = usePlayer();
  const song = player.current;
  const theme = useArtworkTheme(song?.id);
  const { settings } = useSettings();
  const lyrics = useLyrics(song?.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!song) onClose();
  }, [song, onClose]);
  if (!song) return null;

  const style = {
    "--np-color": theme?.color,
    "--np-deep": theme?.deep,
  } as React.CSSProperties;

  return (
    <div className={styles.sheet} style={style} role="dialog" aria-label="Now Playing">
      <IconButton icon="caret-down" label="Close Now Playing" onClick={onClose} className={styles.close} size={22} />

      <div className={styles.stage}>
        <Artwork src={song.artworkUrl} alt={`${song.title} cover`} radius="xl" className={styles.bigArt} />
        <div>
          <h1 className={styles.stageTitle}>{song.title}</h1>
          <p className={styles.stageArtist}>
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
        </div>
        <Progress className={styles.stageProgress} />
        <Controls className={styles.stageControls} playClass={styles.stagePlay} />
        {settings.developerMode && <Provenance songId={song.id} lyrics={lyrics} />}
      </div>

      <div className={styles.panel}>
        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === "lyrics"} className={`${styles.tab} ${tab === "lyrics" ? styles.tabActive : ""}`} onClick={() => setTab("lyrics")}>
            Lyrics
          </button>
          <button type="button" role="tab" aria-selected={tab === "queue"} className={`${styles.tab} ${tab === "queue" ? styles.tabActive : ""}`} onClick={() => setTab("queue")}>
            Up next
          </button>
        </div>
        {tab === "lyrics" ? <Lyrics lyrics={lyrics} /> : <Queue />}
      </div>
    </div>
  );
}

function useLyrics(songId?: string): LyricsResponse | "loading" | "error" {
  const [state, setState] = useState<{ id: string; value: LyricsResponse | "error" }>();
  useEffect(() => {
    if (!songId) return;
    let live = true;
    api<LyricsResponse>(`/api/lyrics/${songId}`).then(
      (value) => live && setState({ id: songId, value }),
      () => live && setState({ id: songId, value: "error" }),
    );
    return () => {
      live = false;
    };
  }, [songId]);
  return state && state.id === songId ? state.value : "loading";
}

function Lyrics({ lyrics }: { lyrics: LyricsResponse | "loading" | "error" }) {
  const player = usePlayer();
  const { time } = usePlayhead();
  const box = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const ms = time * 1000;

  const data = typeof lyrics === "object" ? lyrics : undefined;
  const synced = data?.sync === "line" || data?.sync === "word";
  const lines = data?.lines ?? [];
  const active = synced ? lines.findLastIndex((l) => l.startMs !== undefined && l.startMs <= ms) : -1;

  useEffect(() => {
    const el = activeRef.current;
    const container = box.current;
    if (el && container) container.scrollTo({ top: el.offsetTop - container.clientHeight * 0.38, behavior: "smooth" });
  }, [active]);

  if (lyrics === "loading") return <p className={styles.lyricsNote}>Finding the words…</p>;
  if (lyrics === "error") return <p className={styles.lyricsNote}>Couldn&apos;t load lyrics right now.</p>;
  if (!lyrics.found) return <p className={styles.lyricsNote}>No lyrics for this one. Just vibes.</p>;
  if (lyrics.instrumental) return <p className={styles.lyricsNote}>It&apos;s an instrumental. Enjoy.</p>;

  return (
    <div ref={box} className={`${styles.lyrics} ${synced ? styles.lyricsSynced : styles.lyricsPlain}`}>
      {lines.map((line, i) => {
        const state = !synced ? undefined : i === active ? "active" : i < active ? "past" : "future";
        const content =
          i === active && line.words?.length
            ? line.words.map((w, j) => (
                <span key={j} className={`${styles.lyricWord} ${w.startMs <= ms ? styles.lyricWordSung : ""}`}>
                  {w.text}
                </span>
              ))
            : line.text || (synced ? <span className={styles.lyricsGap}>♪</span> : " ");
        return (
          <button
            key={i}
            type="button"
            ref={i === active ? activeRef : undefined}
            className={styles.lyricLine}
            data-state={state}
            onClick={() => synced && line.startMs !== undefined && player.seek(line.startMs / 1000)}
            tabIndex={synced ? 0 : -1}
          >
            {content}
            {line.romanized && <span className={styles.romanized}>{line.romanized}</span>}
          </button>
        );
      })}
      {!synced && <p className={styles.lyricsCredit}>These lyrics aren&apos;t synced to the music.</p>}
    </div>
  );
}

function Queue() {
  const player = usePlayer();
  const upcoming = player.queue.slice(player.index + 1);
  const current = player.current;
  return (
    <ol className={styles.queue}>
      <li className={styles.queueHeading}>Now playing</li>
      {current && (
        <li className={`${styles.queueItem} ${styles.queueItemCurrent}`}>
          <Artwork src={current.artworkUrl} size={44} radius="sm" />
          <span className={styles.barTitles}>
            <span className={styles.barTitle}>{current.title}</span>
            <span className={styles.barArtist}>{current.artists.map((a) => a.name).join(", ")}</span>
          </span>
        </li>
      )}
      <li className={styles.queueHeading}>{upcoming.length ? "Up next" : "Nothing queued after this. Add some songs?"}</li>
      {upcoming.map((song, i) => {
        const index = player.index + 1 + i;
        return (
          <li key={`${song.id}-${index}`} className={styles.queueItem} onClick={() => player.jumpTo(index)}>
            <Artwork src={song.artworkUrl} size={44} radius="sm" />
            <span className={styles.barTitles}>
              <span className={styles.barTitle}>{song.title}</span>
              <span className={styles.barArtist}>{song.artists.map((a) => a.name).join(", ")}</span>
            </span>
            <IconButton
              icon="close"
              label={`Remove ${song.title} from queue`}
              onClick={(e) => {
                e.stopPropagation();
                player.removeFromQueue(index);
              }}
            />
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
