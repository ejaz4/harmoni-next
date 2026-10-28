"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { loadLyrics } from "@/lib/lyrics-cache";
import type { SongResult } from "@/server/library/song-view";

// One audio element for the whole app, kept outside React so playback
// carries on across page navigations and React never has to own a
// mutable DOM object.
let element: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!element) {
    element = new Audio();
    element.preload = "auto";
  }
  return element;
}

// For views that animate against the playhead every frame (lyrics) and
// would rather read the element than re-render through React.
export const getPlayerAudio = getAudio;

export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: SongResult[];
  index: number; // -1 when nothing is loaded
  playing: boolean;
  // True from asking to play until audio flows (resolving a source, then
  // buffering), and during mid-song stalls.
  buffering: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  error?: string;
}

interface PlayerApi extends PlayerState {
  current?: SongResult;
  play(songs: SongResult[], startIndex?: number): void;
  playNext(song: SongResult): void;
  addToQueue(song: SongResult): void;
  removeFromQueue(index: number): void;
  jumpTo(index: number): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

const STORAGE_KEY = "harmoni:player";
// A listen counts after 30s, or half the song if it's shorter than a minute.
const LISTEN_THRESHOLD_S = 30;
// Warm up the next song once this one has played for a bit.
const PREFETCH_AFTER_S = 10;

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

// Playhead position without re-rendering the whole tree: only components
// that call this re-render, at animation-frame rate while playing.
function subscribePlayhead(onChange: () => void) {
  const audio = getAudio();
  if (!audio) return () => {};
  let frame = 0;
  const loop = () => {
    onChange();
    frame = requestAnimationFrame(loop);
  };
  const start = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    onChange();
  };
  const stopEvents = ["pause", "seeked", "loadedmetadata", "emptied", "durationchange"];
  audio.addEventListener("playing", start);
  stopEvents.forEach((e) => audio.addEventListener(e, stop));
  if (!audio.paused) start();
  return () => {
    cancelAnimationFrame(frame);
    audio.removeEventListener("playing", start);
    stopEvents.forEach((e) => audio.removeEventListener(e, stop));
  };
}

export function usePlayhead(): { time: number; duration: number } {
  const time = useSyncExternalStore(subscribePlayhead, () => getAudio()?.currentTime ?? 0, () => 0);
  const duration = useSyncExternalStore(
    subscribePlayhead,
    () => {
      const d = getAudio()?.duration;
      return d && Number.isFinite(d) ? d : 0;
    },
    () => 0,
  );
  return { time, duration };
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Saved {
  queue: SongResult[];
  index: number;
  time: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume?: number;
}

function readSaved(): Saved | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null;
    return saved?.queue?.length && saved.index >= 0 && saved.index < saved.queue.length ? saved : undefined;
  } catch {
    return undefined; // storage unavailable or corrupt: start fresh
  }
}

const INITIAL: PlayerState = { queue: [], index: -1, playing: false, buffering: false, shuffle: false, repeat: "off", volume: 1, muted: false };

export function PlayerProvider({ children }: { children: ReactNode }) {
  // The last session's queue is restored after hydration (localStorage isn't
  // available while rendering on the server).
  const [state, setState] = useState<PlayerState>(INITIAL);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  // Per-track bookkeeping, reset whenever a new song loads.
  const track = useRef({ listened: false, prefetched: false, resumeAt: 0 });
  const loadedId = useRef<string | undefined>(undefined);
  const autoplay = useRef(false);

  const current = state.index >= 0 ? state.queue[state.index] : undefined;

  useEffect(() => {
    const saved = readSaved();
    if (!saved) return;
    track.current.resumeAt = saved.time ?? 0;
    // Restoring from storage is syncing with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, queue: saved.queue, index: saved.index, shuffle: saved.shuffle, repeat: saved.repeat, volume: saved.volume ?? 1 }));
  }, []);

  // Load the current song when it changes (autoplay unless restoring).
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    if (!current) {
      audio.pause();
      audio.removeAttribute("src");
      loadedId.current = undefined;
      return;
    }
    if (loadedId.current === current.id) return;
    loadedId.current = current.id;
    const resumeAt = track.current.resumeAt;
    track.current = { listened: false, prefetched: false, resumeAt: 0 };
    audio.src = `/api/play/${current.id}`;
    if (resumeAt) audio.currentTime = resumeAt;
    if (autoplay.current) void audio.play().catch(() => setState((s) => ({ ...s, buffering: false })));
  }, [current]);

  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    audio.volume = state.volume;
    audio.muted = state.muted;
  }, [state.volume, state.muted]);

  const advance = useCallback((direction: 1 | -1, fromEnded = false) => {
    const s = stateRef.current;
    const audio = getAudio();
    if (!s.queue.length) return;
    if (fromEnded && s.repeat === "one" && audio) {
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    let index = s.index + direction;
    if (index >= s.queue.length) {
      if (s.repeat !== "all") return setState((st) => ({ ...st, playing: false }));
      index = 0;
    }
    autoplay.current = true;
    setState((st) => ({ ...st, index: Math.max(0, index), buffering: true, error: undefined }));
  }, []);

  // The element's events.
  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    const on = (type: string, fn: () => void) => {
      audio.addEventListener(type, fn);
      return () => audio.removeEventListener(type, fn);
    };
    const offs = [
      // Changing the source fires "pause"; "play" fires as soon as playback is
      // requested again, so the spinner shows while the next song resolves.
      on("play", () => setState((s) => ({ ...s, buffering: true }))),
      on("playing", () => setState((s) => ({ ...s, playing: true, buffering: false, error: undefined }))),
      on("pause", () => setState((s) => ({ ...s, playing: false, buffering: false }))),
      on("waiting", () => setState((s) => ({ ...s, buffering: true }))),
      on("ended", () => {
        setState((s) => ({ ...s, buffering: false }));
        advance(1, true);
      }),
      on("error", () => {
        if (!audio.getAttribute("src")) return;
        const title = stateRef.current.queue[stateRef.current.index]?.title ?? "this song";
        setState((s) => ({ ...s, playing: false, buffering: false, error: `Couldn't play ${title}.` }));
      }),
      on("timeupdate", () => {
        const s = stateRef.current;
        const song = s.queue[s.index];
        if (!song) return;
        const t = audio.currentTime;
        const threshold = Number.isFinite(audio.duration) ? Math.min(LISTEN_THRESHOLD_S, audio.duration / 2) : LISTEN_THRESHOLD_S;
        if (!track.current.listened && t >= threshold) {
          track.current.listened = true;
          void fetch("/api/plays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ songId: song.id }) });
        }
        if (!track.current.prefetched && t >= PREFETCH_AFTER_S) {
          track.current.prefetched = true;
          const upcoming = s.queue[s.index + 1] ?? (s.repeat === "all" ? s.queue[0] : undefined);
          if (upcoming && upcoming.id !== song.id) {
            // A one-byte request makes the server resolve and fully cache it.
            void fetch(`/api/play/${upcoming.id}`, { headers: { Range: "bytes=0-0" } }).catch(() => {});
            void loadLyrics(upcoming.id).catch(() => {});
          }
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [advance]);

  // Remember the queue and position so a reload picks up where you were.
  useEffect(() => {
    const save = () => {
      try {
        const s = stateRef.current;
        const saved: Saved = { queue: s.queue.slice(0, 500), index: s.index, time: getAudio()?.currentTime ?? 0, shuffle: s.shuffle, repeat: s.repeat, volume: s.volume };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Private mode or full storage: not worth bothering anyone about.
      }
    };
    const timer = setInterval(save, 5000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  const api = useMemo<PlayerApi>(() => {
    const replace = (queue: SongResult[], index: number) => {
      autoplay.current = true;
      loadedId.current = undefined; // replay even if it's the same song
      setState((s) => ({ ...s, queue, index, buffering: true, error: undefined }));
    };
    return {
      ...state,
      current,
      play(songs, startIndex = 0) {
        if (!songs.length) return;
        if (stateRef.current.shuffle) {
          const first = songs[startIndex];
          replace([first, ...shuffled(songs.filter((_, i) => i !== startIndex))], 0);
        } else {
          replace(songs, startIndex);
        }
      },
      playNext(song) {
        setState((s) => {
          if (s.index < 0) return { ...s, queue: [song], index: 0 };
          const queue = [...s.queue];
          queue.splice(s.index + 1, 0, song);
          return { ...s, queue };
        });
      },
      addToQueue(song) {
        setState((s) => (s.index < 0 ? { ...s, queue: [song], index: 0 } : { ...s, queue: [...s.queue, song] }));
      },
      removeFromQueue(i) {
        setState((s) => {
          if (i === s.index) return s; // skip the playing song with next() instead
          return { ...s, queue: s.queue.filter((_, j) => j !== i), index: i < s.index ? s.index - 1 : s.index };
        });
      },
      jumpTo(i) {
        autoplay.current = true;
        setState((s) => ({ ...s, index: i, buffering: true, error: undefined }));
      },
      toggle() {
        const audio = getAudio();
        if (!audio || !current) return;
        if (audio.paused) {
          autoplay.current = true;
          setState((s) => ({ ...s, buffering: true }));
          void audio.play().catch(() => setState((s) => ({ ...s, buffering: false })));
        } else {
          audio.pause();
        }
      },
      next: () => advance(1),
      prev() {
        // Like every player: first press restarts the song, second goes back.
        const audio = getAudio();
        if (audio && audio.currentTime > 3) audio.currentTime = 0;
        else advance(-1);
      },
      seek(seconds) {
        const audio = getAudio();
        if (audio && Number.isFinite(seconds)) audio.currentTime = Math.max(0, seconds);
      },
      setShuffle(on) {
        setState((s) => {
          if (!on || s.index < 0) return { ...s, shuffle: on };
          return { ...s, shuffle: on, queue: [...s.queue.slice(0, s.index + 1), ...shuffled(s.queue.slice(s.index + 1))] };
        });
      },
      cycleRepeat() {
        setState((s) => ({ ...s, repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" }));
      },
      setVolume(volume) {
        setState((s) => ({ ...s, volume: Math.min(1, Math.max(0, volume)), muted: false }));
      },
      setMuted(muted) {
        setState((s) => ({ ...s, muted }));
      },
    };
  }, [state, current, advance]);

  // OS media controls (keyboard media keys, lock screen, headphones).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artists.map((a) => a.name).join(", "),
          album: current.album?.title ?? "",
          artwork: current.artworkUrl ? [{ src: `/api/songs/${current.id}/artwork`, sizes: "512x512" }] : [],
        })
      : null;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => api.toggle()],
      ["pause", () => api.toggle()],
      ["nexttrack", () => api.next()],
      ["previoustrack", () => api.prev()],
      ["seekto", (d) => d.seekTime !== undefined && api.seek(d.seekTime)],
    ];
    handlers.forEach(([action, fn]) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // Not every browser supports every action.
      }
    });
  }, [api, current]);

  return <PlayerContext value={api}>{children}</PlayerContext>;
}
