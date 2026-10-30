"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useUser } from "@/components/providers/user";
import { api as request } from "@/lib/api";
import { loadLyrics } from "@/lib/lyrics-cache";
import type { SongResult } from "@/server/library/song-view";
import { shuffleQueue, unshuffleQueue } from "./shuffle";

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

// Songs autoplay added are marked, so the queue can show them apart and
// songs someone queues themselves go in ahead of them.
// `pos`: its place in the list before shuffling (see ./shuffle).
export type QueueSong = SongResult & { autoplay?: true; pos?: number };

interface PlayerState {
  queue: QueueSong[];
  index: number; // -1 when nothing is loaded
  playing: boolean;
  // True from asking to play until audio flows (resolving a source, then
  // buffering), and during mid-song stalls.
  buffering: boolean;
  shuffle: boolean;
  unshuffled?: QueueSong[]; // the order to go back to when shuffle goes off
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  error?: string;
}

interface PlayerApi extends PlayerState {
  current?: SongResult;
  // `shuffle` turns shuffle on as it starts (a "shuffle play" button).
  play(songs: SongResult[], startIndex?: number, options?: { shuffle?: boolean }): void;
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
// Autoplay tops the queue up once this few songs are left after the current one.
const AUTOPLAY_WHEN_LEFT = 1;
const AUTOPLAY_RETRIES = 3;
const AUTOPLAY_RETRY_MS = 8000;
const SLICES = 20; // a listen's "heard" mask: the song in 5% slices

type ListenReason = "ended" | "skip" | "back" | "close" | "error";

// What's been heard of the current song, reported to Super Processing when
// it stops being current. Seeks don't count as listening.
interface Heard {
  songId?: string;
  playedMs: number;
  mask: number;
  replays: number;
  lastT: number;
  durationS?: number;
  autoplay: boolean;
}
const NOT_LISTENING: Heard = { playedMs: 0, mask: 0, replays: 0, lastT: 0, autoplay: false };

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

interface Saved {
  queue: QueueSong[];
  index: number;
  time: number;
  shuffle: boolean;
  unshuffled?: QueueSong[];
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

  const user = useUser();
  const userRef = useRef(user);
  useLayoutEffect(() => {
    userRef.current = user;
  });

  const heard = useRef<Heard>(NOT_LISTENING);
  // Why the current song is about to stop being current; set by whatever moves the queue.
  const leaving = useRef<ListenReason>("skip");

  const reportListen = useCallback((reason: ListenReason) => {
    const h = heard.current;
    heard.current = NOT_LISTENING;
    if (!h.songId || h.playedMs < 2000 || !userRef.current?.superProcessing) return;
    const body = JSON.stringify({
      songId: h.songId,
      playedMs: Math.round(h.playedMs),
      positionMs: Math.round(h.lastT * 1000),
      durationMs: h.durationS ? Math.round(h.durationS * 1000) : undefined,
      heard: h.mask,
      replays: h.replays,
      reason,
      context: h.autoplay ? "autoplay" : undefined,
    });
    // A beacon survives the page closing; fetch with keepalive where beacons aren't allowed.
    const sent = navigator.sendBeacon?.("/api/listens", new Blob([body], { type: "application/json" }));
    if (!sent) void fetch("/api/listens", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }, []);

  // Asks for more songs when the queue is about to run out. One request at
  // a time; resolves to whether anything was added.
  const extending = useRef<Promise<boolean> | null>(null);
  // Bumped whenever someone starts something new: autoplay picks for the
  // old queue are thrown away, never tacked onto what they chose.
  const queueGeneration = useRef(0);
  const [autoplayRetry, setAutoplayRetry] = useState(0);
  const retries = useRef({ songId: "", left: 0 });
  const extendQueue = useCallback((): Promise<boolean> => {
    if (extending.current) return extending.current;
    const s = stateRef.current;
    const song = s.queue[s.index];
    if (!song || !userRef.current?.autoplay) return Promise.resolve(false);
    if (retries.current.songId !== song.id) retries.current = { songId: song.id, left: AUTOPLAY_RETRIES };
    const generation = queueGeneration.current;
    const seeds = [0, 1, 2].flatMap((back) => s.queue[s.index - back]?.id ?? []);
    const exclude = s.queue.slice(-400).map((q) => q.id);
    const pending = request<SongResult[]>("/api/autoplay", { method: "POST", json: { seeds, exclude } })
      .then((songs) => {
        if (generation !== queueGeneration.current) return false;
        let added = false;
        setState((st) => {
          const have = new Set(st.queue.map((q) => q.id));
          const more = songs.filter((x) => !have.has(x.id)).map((x): QueueSong => ({ ...x, autoplay: true }));
          added = more.length > 0;
          return added ? { ...st, queue: [...st.queue, ...more] } : st;
        });
        return songs.length > 0 && added;
      })
      .catch(() => false)
      .then((added) => {
        if (generation !== queueGeneration.current) return false; // a newer request owns extending now
        extending.current = null;
        // A radio no one has asked for before can take a moment to build; ask again while the song plays.
        if (!added && retries.current.songId === song.id && retries.current.left-- > 0) {
          setTimeout(() => setAutoplayRetry((n) => n + 1), AUTOPLAY_RETRY_MS);
        }
        return added;
      });
    extending.current = pending;
    return pending;
  }, []);

  const current = state.index >= 0 ? state.queue[state.index] : undefined;

  useEffect(() => {
    const saved = readSaved();
    if (!saved) return;
    track.current.resumeAt = saved.time ?? 0;
    // Restoring from storage is syncing with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, queue: saved.queue, index: saved.index, shuffle: saved.shuffle, unshuffled: saved.unshuffled, repeat: saved.repeat, volume: saved.volume ?? 1 }));
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
    reportListen(leaving.current);
    leaving.current = "skip";
    loadedId.current = current.id;
    const resumeAt = track.current.resumeAt;
    track.current = { listened: false, prefetched: false, resumeAt: 0 };
    audio.src = `/api/play/${current.id}`;
    if (resumeAt) audio.currentTime = resumeAt;
    if (autoplay.current) void audio.play().catch(() => setState((s) => ({ ...s, buffering: false })));
  }, [current, reportListen]);

  // Autoplay: keep a song or so in hand past the current one.
  const autoplayOn = !!user?.autoplay;
  useEffect(() => {
    if (autoplayOn && state.index >= 0 && state.index >= state.queue.length - 1 - AUTOPLAY_WHEN_LEFT) void extendQueue();
  }, [autoplayOn, state.index, state.queue.length, autoplayRetry, extendQueue]);

  // Turned off: what autoplay had lined up goes (what's playing stays).
  const userLoaded = !!user;
  useEffect(() => {
    if (!userLoaded || autoplayOn) return;
    // Mirrors the account preference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => (s.queue.some((q, i) => i > s.index && q.autoplay) ? { ...s, queue: s.queue.filter((q, i) => i <= s.index || !q.autoplay) } : s));
  }, [userLoaded, autoplayOn]);

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
      if (s.repeat !== "all") {
        // Out of songs: autoplay may have more on the way.
        void extendQueue().then((added) => {
          if (added) autoplay.current = true;
          setState((st) => (added && st.index + 1 < st.queue.length ? { ...st, index: st.index + 1, buffering: true, error: undefined } : { ...st, playing: false }));
        });
        return;
      }
      index = 0;
    }
    leaving.current = fromEnded ? "ended" : direction < 0 ? "back" : "skip";
    autoplay.current = true;
    setState((st) => ({ ...st, index: Math.max(0, index), buffering: true, error: undefined }));
  }, [extendQueue]);

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
        // Reported now: on repeat-one or at the end of the queue the song doesn't change.
        reportListen("ended");
        advance(1, true);
      }),
      on("seeking", () => {
        const h = heard.current;
        // Dragging back over what they've already heard: they wanted that part again.
        if (h.songId && audio.currentTime < h.lastT - 3 && h.playedMs > 5000) h.replays++;
        h.lastT = audio.currentTime;
      }),
      on("error", () => {
        if (!audio.getAttribute("src")) return;
        reportListen("error");
        const title = stateRef.current.queue[stateRef.current.index]?.title ?? "this song";
        setState((s) => ({ ...s, playing: false, buffering: false, error: `Couldn't play ${title}.` }));
      }),
      on("timeupdate", () => {
        const s = stateRef.current;
        const song = s.queue[s.index];
        if (!song) return;
        const t = audio.currentTime;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
        let h = heard.current;
        if (h.songId !== song.id) h = heard.current = { ...NOT_LISTENING, songId: song.id, lastT: t, autoplay: !!(song as QueueSong).autoplay };
        const dt = t - h.lastT;
        if (dt > 0 && dt < 1.5 && !audio.seeking) {
          h.playedMs += dt * 1000;
          if (duration) {
            const to = Math.min(SLICES - 1, Math.floor((t / duration) * SLICES));
            for (let i = Math.max(0, Math.floor((h.lastT / duration) * SLICES)); i <= to; i++) h.mask |= 1 << i;
          }
        }
        h.lastT = t;
        h.durationS = duration;
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
  }, [advance, reportListen]);

  // Remember the queue and position so a reload picks up where you were.
  useEffect(() => {
    const save = () => {
      try {
        const s = stateRef.current;
        const saved: Saved = { queue: s.queue.slice(0, 500), index: s.index, time: getAudio()?.currentTime ?? 0, shuffle: s.shuffle, unshuffled: s.unshuffled?.slice(0, 500), repeat: s.repeat, volume: s.volume };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch {
        // Private mode or full storage: not worth bothering anyone about.
      }
    };
    const leave = () => {
      save();
      reportListen("close");
    };
    const timer = setInterval(save, 5000);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
    };
  }, [reportListen]);

  const api = useMemo<PlayerApi>(() => {
    const replace = (queue: QueueSong[], index: number, unshuffled?: QueueSong[], shuffle?: boolean) => {
      queueGeneration.current++;
      extending.current = null;
      leaving.current = "skip";
      autoplay.current = true;
      loadedId.current = undefined; // replay even if it's the same song
      setState((s) => ({ ...s, queue, index, unshuffled, shuffle: shuffle ?? s.shuffle, buffering: true, error: undefined }));
    };
    return {
      ...state,
      current,
      play(songs, startIndex = 0, options) {
        if (!songs.length) return;
        if (options?.shuffle || stateRef.current.shuffle) {
          const { queue, unshuffled } = shuffleQueue(songs, 0, startIndex);
          replace(queue, 0, unshuffled, true);
        } else {
          replace(songs, startIndex);
        }
      },
      playNext(song) {
        setState((s) => {
          if (s.index < 0) return { ...s, queue: [song], index: 0, unshuffled: undefined };
          const queue = [...s.queue];
          queue.splice(s.index + 1, 0, song);
          return { ...s, queue };
        });
      },
      addToQueue(song) {
        setState((s) => {
          if (s.index < 0) return { ...s, queue: [song], index: 0, unshuffled: undefined };
          // Ahead of anything autoplay lined up.
          const at = s.queue.findIndex((q, i) => i > s.index && q.autoplay);
          if (at < 0) return { ...s, queue: [...s.queue, song] };
          return { ...s, queue: [...s.queue.slice(0, at), song, ...s.queue.slice(at)] };
        });
      },
      removeFromQueue(i) {
        setState((s) => {
          if (i === s.index) return s; // skip the playing song with next() instead
          return { ...s, queue: s.queue.filter((_, j) => j !== i), index: i < s.index ? s.index - 1 : s.index };
        });
      },
      jumpTo(i) {
        leaving.current = i < stateRef.current.index ? "back" : "skip";
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
          if (on === s.shuffle || s.index < 0) return { ...s, shuffle: on, unshuffled: on ? s.unshuffled : undefined };
          if (!on) return { ...s, shuffle: false, queue: unshuffleQueue(s.queue, s.index, s.unshuffled), unshuffled: undefined };
          return { ...s, shuffle: true, ...shuffleQueue(s.queue, s.index) };
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

  // Lock screens show a scrubber and the right play/pause glyph only when
  // told the position and state; keep them in step with the element.
  useEffect(() => {
    const audio = getAudio();
    if (!audio || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const sync = () => {
      ms.playbackState = audio.paused ? "paused" : "playing";
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      try {
        ms.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 });
      } catch {
        // Older browsers lack setPositionState.
      }
    };
    const events = ["play", "pause", "playing", "seeked", "durationchange", "ratechange", "loadedmetadata"];
    events.forEach((e) => audio.addEventListener(e, sync));
    return () => events.forEach((e) => audio.removeEventListener(e, sync));
  }, []);

  return <PlayerContext value={api}>{children}</PlayerContext>;
}
