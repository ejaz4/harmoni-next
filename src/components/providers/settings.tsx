"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-device preferences, kept in localStorage.
interface Settings {
  // Shows where audio and lyrics came from, and links to the debug page.
  developerMode: boolean;
}

const DEFAULTS: Settings = { developerMode: false };
const STORAGE_KEY = "harmoni:settings";
const CHANGED = "harmoni:settings-changed";

// Cached by the raw string so the snapshot stays referentially stable.
let cached: { raw: string | null; value: Settings } = { raw: null, value: DEFAULTS };
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
