"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-device preferences, kept in localStorage.
export interface Settings {
  // Shows where audio and lyrics came from, and links to the debug page.
  developerMode: boolean;
  crossfade: number; // seconds of overlap between songs; 0 = off
  smoothPause: boolean; // ease the volume in and out on play and pause
  preloadNext: boolean; // fetch the next song while this one plays
  keepAwake: boolean; // keep the screen on while lyrics are showing
}

const DEFAULTS: Settings = { developerMode: false, crossfade: 0, smoothPause: true, preloadNext: true, keepAwake: false };
const STORAGE_KEY = "harmoni:settings";
const CHANGED = "harmoni:settings-changed";

// Cached by the raw string so the snapshot stays referentially stable.
let cached: { raw: string | null; value: Settings } = { raw: null, value: DEFAULTS };
// Also for code outside React (the player, mid-song).
export function readSettings(): Settings {
  return read();
}
function read(): Settings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULTS;
  }
  if (raw !== cached.raw) {
    try {
      cached = { raw, value: { ...DEFAULTS, ...(JSON.parse(raw ?? "{}") as Partial<Settings>) } };
    } catch {
      cached = { raw, value: DEFAULTS };
    }
  }
  return cached.value;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange); // other tabs
  window.addEventListener(CHANGED, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((patch: Partial<Settings>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...patch }));
    } catch {}
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { settings, update };
}
