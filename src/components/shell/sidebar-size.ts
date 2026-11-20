"use client";

import { useSyncExternalStore } from "react";

// How wide the sidebar is, and whether it's folded down to a rail of icons.
// Remembered on this device.

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 272;
export const RAIL_WIDTH = 80;
// Dragged narrower than this, it folds to the rail.
export const COLLAPSE_BELOW = 160;

export interface SidebarSize {
  width: number;
  collapsed: boolean;
}

const KEY = "harmoni:sidebar";
const CHANGED = "harmoni:sidebar-changed";
const DEFAULT: SidebarSize = { width: SIDEBAR_DEFAULT, collapsed: false };

let cached: { raw: string | null; value: SidebarSize } = { raw: null, value: DEFAULT };

function read(): SidebarSize {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached.value;
  }
  if (raw !== cached.raw) {
    try {
      const parsed = JSON.parse(raw ?? "null") as Partial<SidebarSize> | null;
      cached = {
        raw,
        value: parsed ? { width: clampWidth(parsed.width ?? SIDEBAR_DEFAULT), collapsed: !!parsed.collapsed } : DEFAULT,
      };
    } catch {
      cached = { raw, value: DEFAULT };
    }
  }
  return cached.value;
}

export const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

export function setSidebarSize(next: Partial<SidebarSize>) {
  const value = { ...read(), ...next };
  value.width = clampWidth(value.width);
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    cached = { raw: null, value };
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

export function useSidebarSize(): SidebarSize {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}
