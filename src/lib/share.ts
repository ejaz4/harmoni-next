"use client";

// Links to things in Harmoni, for copying or sharing. They open on this
// server, for people signed in to it.

export const songPath = (id: string) => `/song/${id}`;
export const profilePath = (username: string) => `/u/${encodeURIComponent(username)}`;

export const absolute = (path: string) => new URL(path, window.location.origin).href;

export async function copyLink(path: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(absolute(path));
    return true;
  } catch {
    return false;
  }
}

// The phone's own share sheet, where there is one.
export const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches;

export async function shareLink(path: string, title: string): Promise<void> {
  await navigator.share({ title, url: absolute(path) }).catch(() => {});
}
