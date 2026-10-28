"use client";

import { useSyncExternalStore } from "react";

// Matches a CSS media query live; false while rendering on the server.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Phone-sized layout: tab bar, mini player, swipeable Now Playing.
export const PHONE = "(max-width: 640px)";
