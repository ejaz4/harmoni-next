"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { readSettings } from "@/components/providers/settings";
import { useToast } from "@/components/providers/toast";
import { useUser } from "@/components/providers/user";
import { api as request } from "@/lib/api";
import { MAX_QUEUE, positionAt, type LinkCommand, type LinkPatch, type LinkState } from "@/lib/link";
import { loadLyrics } from "@/lib/lyrics-cache";
import type { SongResult } from "@/server/library/song-view";
import { LinkProvider, useLinkConnection, useLinkInfo, type LinkHandlers } from "./link";
import { Mixer } from "./mixer";
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

const mixer = new Mixer(getAudio);

// Starts a just-loaded song part way in. Browsers mostly take the position
// straight away, but some only once they know the song's length.
function startAt(audio: HTMLAudioElement, seconds: number) {
  if (!seconds) return;
  try {
    audio.currentTime = seconds;
  } catch {}
  const src = audio.src;
  audio.addEventListener(
    "loadedmetadata",
    () => {
      if (audio.src === src && Math.abs(audio.currentTime - seconds) > 1) audio.currentTime = seconds;
    },
    { once: true },
  );
}

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
  // Moves an upcoming song to another upcoming place (queue indexes).
  moveInQueue(from: number, to: number): void;
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
// Songs shorter than this many crossfades (plus a bit) just play out.
const CROSSFADE_MIN_RATIO = 3;
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

// Harmoni Link: while another device plays, the playhead is that device's,
// worked out from where it last said it was.
interface RemoteClock {
  positionMs: number;
  at: number; // server time
  playing: boolean;
  durationMs?: number;
  offset: number; // server clock minus this one's
}
let remoteClock: RemoteClock | undefined;
let remoteTime = 0;
const remoteListeners = new Set<() => void>();
const readRemoteTime = (r: RemoteClock) => positionAt({ ...r, durationMs: r.durationMs ?? null }, Date.now() + r.offset) / 1000;
function setRemoteClock(clock: RemoteClock | undefined) {
  remoteClock = clock;
  remoteTime = clock ? readRemoteTime(clock) : 0;
  remoteListeners.forEach((fn) => fn());
}

// Where playback is and whether it's moving, wherever it's playing.
export function readPlayhead(): { time: number; paused: boolean } {
  if (remoteClock) return { time: readRemoteTime(remoteClock), paused: !remoteClock.playing };
  const audio = getAudio();
  return { time: audio?.currentTime ?? 0, paused: audio?.paused ?? true };
}

// Playhead position without re-rendering the whole tree: only components
// that call this re-render, at animation-frame rate while playing.
function subscribePlayhead(onChange: () => void) {
  remoteListeners.add(onChange);
  const remoteTick = setInterval(() => {
    if (!remoteClock?.playing) return;
    remoteTime = readRemoteTime(remoteClock);
    onChange();
  }, 250);
  const stopRemote = () => {
    remoteListeners.delete(onChange);
    clearInterval(remoteTick);
  };
  const audio = getAudio();
  if (!audio) return stopRemote;
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
    stopRemote();
    cancelAnimationFrame(frame);
    audio.removeEventListener("playing", start);
    stopEvents.forEach((e) => audio.removeEventListener(e, stop));
  };
}

export function usePlayhead(): { time: number; duration: number } {
  const time = useSyncExternalStore(subscribePlayhead, () => (remoteClock ? remoteTime : (getAudio()?.currentTime ?? 0)), () => 0);
  const duration = useSyncExternalStore(
    subscribePlayhead,
    () => {
      if (remoteClock) return (remoteClock.durationMs ?? 0) / 1000;
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
  const track = useRef({ listened: false, prefetched: false, crossfaded: false, resumeAt: 0 });
  const loadedId = useRef<string | undefined>(undefined);
  const autoplay = useRef(false);

  const user = useUser();
  const userRef = useRef(user);
  useLayoutEffect(() => {
    userRef.current = user;
  });
  const toast = useToast();

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
    // The same song again, unless it failed: then this is a retry.
    if (loadedId.current === current.id && !audio.error) return;
    reportListen(leaving.current);
    leaving.current = "skip";
    loadedId.current = current.id;
    const resumeAt = track.current.resumeAt;
    track.current = { listened: false, prefetched: false, crossfaded: false, resumeAt: 0 };
    audio.src = `/api/play/${current.id}`;
    startAt(audio, resumeAt);
    if (autoplay.current) void audio.play().catch(() => setState((s) => ({ ...s, buffering: false })));
  }, [current, reportListen]);

  // --- Harmoni Link ---

  // Takes on the account's playback (from another device, or the server's
  // copy): its queue, where it's up to, and whether to start playing.
  // Starting happens right here, so a tap that asked for it lets it play.
  const quiet = useRef(false); // what's just been taken on isn't news to report
  const offsetRef = useRef(0);
  // `quietly`: it's the account's playback catching this device up, not this
  // device taking it over, so there's nothing to tell the others.
  const adopt = useCallback(
    (s: LinkState, play: boolean, quietly = false) => {
      const queue = s.queue as QueueSong[];
      const index = queue.length ? Math.min(Math.max(0, s.index), queue.length - 1) : -1;
      const position = positionAt(s, Date.now() + offsetRef.current) / 1000;
      queueGeneration.current++;
      extending.current = null;
      leaving.current = "skip";
      autoplay.current = play;
      quiet.current = quietly;
      setState((st) => ({
        ...st,
        queue,
        index,
        shuffle: s.shuffle,
        unshuffled: (s.unshuffled ?? undefined) as QueueSong[] | undefined,
        repeat: s.repeat,
        buffering: play,
        error: undefined,
      }));
      const audio = getAudio();
      const song = queue[index];
      if (!audio || !song) return;
      reportListen(leaving.current);
      loadedId.current = song.id; // loaded here, not by the effect
      track.current = { listened: false, prefetched: false, crossfaded: false, resumeAt: 0 };
      audio.src = `/api/play/${song.id}`;
      startAt(audio, position);
      if (play)
        void audio.play().catch(() => {
          setState((st) => ({ ...st, buffering: false }));
          toast("Tap play to start it here.");
        });
    },
    [reportListen, toast],
  );

  // Another device's controls, applied here (this device is the one playing).
  const localApiRef = useRef<PlayerApi | null>(null);
  const applyCommand = useCallback((c: LinkCommand) => {
    const api = localApiRef.current;
    if (!api) return;
    // The queue may have moved since they looked: find the song they meant.
    const find = (index: number, songId: string) => {
      const q = stateRef.current.queue;
      if (q[index]?.id === songId) return index;
      let best = -1;
      q.forEach((song, i) => {
        if (song.id === songId && (best < 0 || Math.abs(i - index) < Math.abs(best - index))) best = i;
      });
      return best;
    };
    switch (c.type) {
      case "play":
        return api.play(c.songs as SongResult[], c.startIndex, { shuffle: c.shuffle });
      case "playNext":
        return api.playNext(c.song as SongResult);
      case "addToQueue":
        return api.addToQueue(c.song as SongResult);
      case "removeFromQueue": {
        const i = find(c.index, c.songId);
        return i >= 0 && api.removeFromQueue(i);
      }
      case "jumpTo": {
        const i = find(c.index, c.songId);
        return i >= 0 && api.jumpTo(i);
      }
      case "moveInQueue": {
        const from = find(c.from, c.songId);
        return from >= 0 && api.moveInQueue(from, c.to);
      }
      case "toggle":
        return api.toggle();
      case "next":
        return api.next();
      case "prev":
        return api.prev();
      case "cycleRepeat":
        return api.cycleRepeat();
      case "seek":
        return api.seek(c.seconds);
      case "setShuffle":
        return api.setShuffle(c.on);
      case "setVolume":
        return api.setVolume(c.volume);
      case "setMuted":
        return api.setMuted(c.muted);
    }
  }, []);

  const publishRef = useRef<(reason: "change" | "heartbeat" | "now") => Promise<void>>(async () => {});
  const handlers: LinkHandlers = {
    onHello(hello) {
      if (hello.active === hello.self) return; // still ours: carry on
      // Playing here already (back after a dropped connection): it's playing here.
      if (getAudio() && !getAudio()!.paused) return void publishRef.current("now");
      if (hello.active) return; // playing elsewhere: this device is its remote
      if (hello.state?.queue.length) adopt(hello.state, false, true);
    },
    onCommand: applyCommand,
    onTransfer(linkState, play) {
      if (linkState) adopt(linkState, play);
    },
    onRelease() {
      getAudio()?.pause();
    },
    onOrphaned(linkState) {
      adopt(linkState, false, true);
    },
  };
  const link = useLinkConnection(handlers, !!user?.server.features.link);
  useLayoutEffect(() => {
    offsetRef.current = link.offset;
  });
  // Another device is playing: this one shows and controls that. If it
  // hasn't heard the details yet, what it last had stands in until it does,
  // so controls never quietly start playing here instead.
  const remoteState = useMemo<LinkState | null>(() => {
    if (!link.active || link.active === link.self) return null;
    return (
      link.state ?? {
        queue: state.queue,
        unshuffled: state.unshuffled ?? null,
        index: state.index,
        shuffle: state.shuffle,
        repeat: state.repeat,
        playing: false,
        buffering: false,
        volume: state.volume,
        muted: state.muted,
        positionMs: 0,
        at: 0,
      }
    );
  }, [link.active, link.self, link.state, state.queue, state.unshuffled, state.index, state.shuffle, state.repeat, state.volume, state.muted]);
  const isRemote = !!remoteState;
  const isRemoteRef = useRef(isRemote);
  const linkRef = useRef(link);
  useLayoutEffect(() => {
    isRemoteRef.current = isRemote;
    linkRef.current = link;
  });

  // This device's playback, for everyone else: on every change, and every
  // few seconds while playing so their playheads stay true.
  const lastSent = useRef<{ sig?: string; queue?: unknown; unshuffled?: unknown }>({});
  const publish = useCallback(async (reason: "change" | "heartbeat" | "now") => {
    const l = linkRef.current;
    if (!l.connected || isRemoteRef.current) return;
    const s = stateRef.current;
    const audio = getAudio();
    const sig = [s.index, s.shuffle, s.repeat, s.playing, s.buffering, s.volume, s.muted, s.error ?? ""].join("|");
    const queueChanged = s.queue !== lastSent.current.queue;
    const unshuffledChanged = s.unshuffled !== lastSent.current.unshuffled;
    const changed = sig !== lastSent.current.sig || queueChanged || unshuffledChanged;
    const active = l.active === l.self;
    if (quiet.current && reason === "change") {
      quiet.current = false;
      lastSent.current = { sig, queue: s.queue, unshuffled: s.unshuffled };
      return;
    }
    if (reason === "change" && !changed) return;
    if (reason === "heartbeat" && !(active && s.playing)) return;
    lastSent.current = { sig, queue: s.queue, unshuffled: s.unshuffled };
    const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : null;
    const patch: LinkPatch = {
      index: s.index,
      shuffle: s.shuffle,
      repeat: s.repeat,
      playing: s.playing,
      buffering: s.buffering,
      error: s.error ?? null,
      volume: s.volume,
      muted: s.muted,
      positionMs: Math.round((audio?.currentTime ?? 0) * 1000),
      durationMs: duration,
      ...(queueChanged && { queue: s.queue.slice(0, MAX_QUEUE) }),
      ...(unshuffledChanged && { unshuffled: s.unshuffled?.slice(0, MAX_QUEUE) ?? null }),
    };
    const result = await l.publish(patch, !active);
    // Not taken (it lost a race, or the server lost us): send it all again next time.
    if (result !== "ok" && result !== "stale") lastSent.current = {};
  }, []);
  useLayoutEffect(() => {
    publishRef.current = publish;
  });

  useEffect(() => {
    if (!link.connected || isRemote) return;
    const timer = setTimeout(() => void publish("change"), 150);
    return () => clearTimeout(timer);
  }, [publish, link.connected, isRemote, state.queue, state.unshuffled, state.index, state.shuffle, state.repeat, state.playing, state.buffering, state.error, state.volume, state.muted]);

  useEffect(() => {
    const audio = getAudio();
    if (!audio) return;
    const seeked = () => void publish("heartbeat");
    audio.addEventListener("seeked", seeked);
    const heartbeat = setInterval(() => void publish("heartbeat"), 5000);
    return () => {
      audio.removeEventListener("seeked", seeked);
      clearInterval(heartbeat);
    };
  }, [publish]);

  // The other device's playhead, for the progress bar and lyrics here.
  const remoteSong = remoteState ? (remoteState.queue[remoteState.index] as QueueSong | undefined) : undefined;
  useEffect(() => {
    setRemoteClock(
      remoteState
        ? {
            positionMs: remoteState.positionMs,
            at: remoteState.at,
            playing: remoteState.playing,
            durationMs: remoteState.durationMs ?? remoteSong?.durationMs,
            offset: link.offset,
          }
        : undefined,
    );
  }, [remoteState, remoteSong, link.offset]);
  useEffect(() => () => setRemoteClock(undefined), []);

  // Picking a device in the Link menu.
  const transfer = useCallback(
    async (to: string) => {
      const l = linkRef.current;
      if (to === l.self) {
        // Taking it here: start now, while the tap still counts.
        if (l.state && isRemoteRef.current) adopt(l.state, l.state.playing);
        await l.transfer(to);
        return;
      }
      // Moving it away: make sure the server has exactly where it's up to.
      if (!isRemoteRef.current) await publish("now");
      if (!(await l.transfer(to))) toast("Couldn't reach that device.", "error");
    },
    [adopt, publish, toast],
  );
  const linkInfo = useLinkInfo(link, transfer);

  // Autoplay: keep a song or so in hand past the current one (the playing device does it).
  const autoplayOn = !!user?.autoplay;
  useEffect(() => {
    if (isRemote) return;
    if (autoplayOn && state.index >= 0 && state.index >= state.queue.length - 1 - AUTOPLAY_WHEN_LEFT) void extendQueue();
  }, [isRemote, autoplayOn, state.index, state.queue.length, autoplayRetry, extendQueue]);

  // Turned off: what autoplay had lined up goes (what's playing stays).
  const userLoaded = !!user;
  useEffect(() => {
    if (!userLoaded || autoplayOn) return;
    // Mirrors the account preference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => (s.queue.some((q, i) => i > s.index && q.autoplay) ? { ...s, queue: s.queue.filter((q, i) => i <= s.index || !q.autoplay) } : s));
  }, [userLoaded, autoplayOn]);

  useEffect(() => {
    mixer.setLevel(state.volume, state.muted);
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
      on("playing", () => {
        mixer.playing();
        setState((s) => ({ ...s, playing: true, buffering: false, error: undefined }));
      }),
      on("pause", () => {
        // Paused, skipped or moved elsewhere mid-crossfade: the song going out stops too.
        if (!mixer.handingOff) mixer.cancel();
        setState((s) => ({ ...s, playing: false, buffering: false }));
      }),
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
        mixer.cancel();
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
        // Crossfade: a few seconds from the end, the next song starts under this one.
        const crossfade = readSettings().crossfade;
        if (crossfade && duration && !track.current.crossfaded && duration - t <= crossfade && duration > crossfade * CROSSFADE_MIN_RATIO && !audio.paused && !isRemoteRef.current) {
          const upcoming = s.repeat === "one" ? undefined : (s.queue[s.index + 1] ?? (s.repeat === "all" ? s.queue[0] : undefined));
          if (upcoming) {
            track.current.crossfaded = true;
            const index = s.index;
            void mixer.crossfade(crossfade).then((started) => {
              if (!started) return;
              if (stateRef.current.index !== index) return mixer.cancel(); // they moved on meanwhile
              advance(1, true);
            });
          }
        }
        if (!track.current.prefetched && t >= PREFETCH_AFTER_S && readSettings().preloadNext) {
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

  const localApi = useMemo<PlayerApi>(() => {
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
      moveInQueue(from, to) {
        setState((s) => {
          if (from === to || from <= s.index || to <= s.index || from >= s.queue.length || to >= s.queue.length) return s;
          const queue = [...s.queue];
          const [song] = queue.splice(from, 1);
          queue.splice(to, 0, song);
          return { ...s, queue };
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
        const smooth = readSettings().smoothPause;
        // A song that failed won't load by being played again (and may not
        // even count as paused): ask for it afresh.
        if (audio.error) {
          autoplay.current = true;
          const at = audio.currentTime;
          audio.src = `/api/play/${current.id}`;
          startAt(audio, at);
          setState((s) => ({ ...s, buffering: true, error: undefined }));
          void mixer.play(smooth).catch(() => setState((s) => ({ ...s, buffering: false })));
        } else if (audio.paused || mixer.pausing) {
          autoplay.current = true;
          if (audio.paused) setState((s) => ({ ...s, buffering: true }));
          void mixer.play(smooth).catch(() => setState((s) => ({ ...s, buffering: false })));
        } else {
          mixer.pause(smooth);
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
  useLayoutEffect(() => {
    localApiRef.current = localApi;
  });

  // Playing on another device: its playback, and controls that go to it.
  const { command, nudge } = link;
  const remoteApi = useMemo<PlayerApi | null>(() => {
    if (!remoteState) return null;
    const r = remoteState;
    const queue = r.queue as QueueSong[];
    const now = () => Date.now() + link.offset;
    const send = (c: LinkCommand) =>
      void command(c).then((sent) => {
        if (!sent) toast("Couldn't reach the device that's playing.", "error");
      });
    return {
      queue,
      index: r.index,
      playing: r.playing,
      buffering: r.buffering,
      shuffle: r.shuffle,
      unshuffled: (r.unshuffled ?? undefined) as QueueSong[] | undefined,
      repeat: r.repeat,
      volume: r.volume,
      muted: r.muted,
      error: r.error ?? undefined,
      current: queue[r.index],
      play: (songs, startIndex = 0, options) => send({ type: "play", songs, startIndex, shuffle: options?.shuffle }),
      playNext: (song) => send({ type: "playNext", song }),
      addToQueue: (song) => send({ type: "addToQueue", song }),
      removeFromQueue(i) {
        const songId = queue[i]?.id;
        if (!songId || i === r.index) return;
        nudge({ queue: queue.filter((_, j) => j !== i), index: i < r.index ? r.index - 1 : r.index });
        send({ type: "removeFromQueue", index: i, songId });
      },
      moveInQueue(from, to) {
        const songId = queue[from]?.id;
        if (!songId || from <= r.index || to <= r.index) return;
        const moved = [...queue];
        moved.splice(to, 0, ...moved.splice(from, 1));
        nudge({ queue: moved });
        send({ type: "moveInQueue", from, to, songId });
      },
      jumpTo(i) {
        const songId = queue[i]?.id;
        if (!songId) return;
        nudge({ index: i, positionMs: 0, at: now() });
        send({ type: "jumpTo", index: i, songId });
      },
      toggle() {
        nudge({ playing: !r.playing, positionMs: positionAt(r, now()), at: now() });
        send({ type: "toggle" });
      },
      next: () => send({ type: "next" }),
      prev: () => send({ type: "prev" }),
      seek(seconds) {
        nudge({ positionMs: seconds * 1000, at: now() });
        send({ type: "seek", seconds });
      },
      setShuffle(on) {
        nudge({ shuffle: on });
        send({ type: "setShuffle", on });
      },
      cycleRepeat() {
        nudge({ repeat: r.repeat === "off" ? "all" : r.repeat === "all" ? "one" : "off" });
        send({ type: "cycleRepeat" });
      },
      setVolume(volume) {
        nudge({ volume, muted: false });
        send({ type: "setVolume", volume });
      },
      setMuted(muted) {
        nudge({ muted });
        send({ type: "setMuted", muted });
      },
    };
  }, [remoteState, link.offset, command, nudge, toast]);
  const api = remoteApi ?? localApi;

  // OS media controls (keyboard media keys, lock screen, headphones).
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const current = api.current;
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
  }, [api]);

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

  return (
    <PlayerContext value={api}>
      <LinkProvider value={linkInfo}>{children}</LinkProvider>
    </PlayerContext>
  );
}
