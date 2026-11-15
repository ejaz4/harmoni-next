// Harmoni Link: one queue per account, played on whichever of their devices
// they pick and controlled from any of them (like Spotify Connect). Types
// shared by the server and the player, and how a device names itself.

export type DeviceKind = "phone" | "tablet" | "computer";

export interface LinkDevice {
  id: string; // one per open Harmoni (a tab, or the installed app)
  name: string;
  kind: DeviceKind;
  until: number; // server time it counts as gone, unless it checks in again
}

export type RepeatMode = "off" | "all" | "one";

// The account's playback, as the device playing it last reported it.
// Songs are the player's own objects; the server only stores them.
export interface LinkState {
  queue: unknown[];
  unshuffled?: unknown[] | null;
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playing: boolean;
  buffering: boolean;
  error?: string | null;
  volume: number;
  muted: boolean;
  positionMs: number;
  durationMs?: number | null;
  at: number; // server time positionMs was true at
  rev?: number; // counts every change, so a device can tell it missed one
}

// What the playing device sends: everything but the queue every time, the
// queue (and unshuffled order) only when it changed.
export type LinkPatch = Omit<LinkState, "queue" | "unshuffled" | "at" | "rev"> & { queue?: unknown[]; unshuffled?: unknown[] | null };

// Things another device asks the playing one to do. Indexes come with the
// song they pointed at, in case the queue moved in the meantime.
export type LinkCommand =
  | { type: "play"; songs: unknown[]; startIndex: number; shuffle?: boolean }
  | { type: "playNext" | "addToQueue"; song: unknown }
  | { type: "removeFromQueue" | "jumpTo"; index: number; songId: string }
  | { type: "moveInQueue"; from: number; to: number; songId: string }
  | { type: "toggle" | "next" | "prev" | "cycleRepeat" }
  | { type: "seek"; seconds: number }
  | { type: "setShuffle"; on: boolean }
  | { type: "setVolume"; volume: number }
  | { type: "setMuted"; muted: boolean };

export type LinkEvent =
  // On connecting: who's here, who's playing, and the account's playback.
  | { type: "hello"; self: string; now: number; devices: LinkDevice[]; active: string | null; state: LinkState | null }
  | { type: "devices"; now: number; devices: LinkDevice[]; active: string | null }
  // Every few seconds: proof the stream's alive, and what everything should
  // be by now, in case a message went missing.
  | { type: "ping"; now: number; devices: LinkDevice[]; active: string | null; rev: number }
  | { type: "state"; from: string; state: Partial<LinkState> & { at: number } }
  | { type: "command"; command: LinkCommand }
  // Playback moves to this device: carry on from here.
  | { type: "transfer"; state: LinkState | null; play: boolean }
  // Playback moved away: stop.
  | { type: "release" };

export const MAX_QUEUE = 500;

export function positionAt(state: Pick<LinkState, "positionMs" | "playing" | "at" | "durationMs">, now: number): number {
  const ms = state.positionMs + (state.playing ? Math.max(0, now - state.at) : 0);
  return state.durationMs ? Math.min(ms, state.durationMs) : ms;
}

// "iPhone", "Chrome on Mac": good enough to tell devices apart, and
// renameable in Settings.
export function describeDevice(): { name: string; kind: DeviceKind } {
  if (typeof navigator === "undefined") return { name: "Browser", kind: "computer" };
  return describeUserAgent(navigator.userAgent, navigator.maxTouchPoints);
}

// The same from a user agent alone (a signed-in session, in Settings). An
// iPad asking for desktop sites only gives itself away by its touch points.
export function describeUserAgent(ua: string, touchPoints = 0): { name: string; kind: DeviceKind } {
  if (/iPhone|iPod/.test(ua)) return { name: "iPhone", kind: "phone" };
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return { name: "iPad", kind: "tablet" };
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? { name: "Android phone", kind: "phone" } : { name: "Android tablet", kind: "tablet" };
  const os = /CrOS/.test(ua) ? "ChromeOS" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux|X11/.test(ua) ? "Linux" : "computer";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return { name: `${browser} on ${os}`, kind: "computer" };
}
