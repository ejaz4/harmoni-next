"use client";

import type { LyricsResponse } from "@/server/lyrics/service";
import { api } from "./api";

// Lyrics kept in the browser for the session, so reopening Now Playing (or
// reaching a song the player already prefetched) needs no request. The
// server does the real caching and rechecking; this is just a short-lived copy.
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: Promise<LyricsResponse> }>();

export function loadLyrics(songId: string): Promise<LyricsResponse> {
  const hit = cache.get(songId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = api<LyricsResponse>(`/api/lyrics/${songId}`);
  cache.set(songId, { at: Date.now(), value });
  // Don't keep failures around; the next open should try again.
  value.catch(() => cache.delete(songId));
  return value;
}
