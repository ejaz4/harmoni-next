"use client";

import { useEffect } from "react";

// Keeps the screen on while `on`. Browsers drop the lock whenever the page
// is hidden, so it's asked for again each time the page comes back.
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let gone = false;
    const request = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (gone) void next.release();
        else lock = next;
      } catch {
        // Low battery, or not allowed: the screen sleeps as usual.
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}
