"use client";

import { useEffect, useState } from "react";

// Colours taken from a song's cover: the artwork sets the mood, the way the
// hero in the original Harmoni design blends into its photo.

export interface ArtworkTheme {
  color: string; // the cover's character colour, e.g. "rgb(170 186 199)"
  deep: string; // a darker version for large backgrounds behind light text
  ink: string; // readable text on `color`
  inkMuted: string;
  light: boolean; // light covers need a darker veil behind white text
}

const cache = new Map<string, Promise<ArtworkTheme | undefined>>();

// Colours from any same-origin image (song artwork, artist photos).
export function imageTheme(src: string): Promise<ArtworkTheme | undefined> {
  let pending = cache.get(src);
  if (!pending) {
    pending = extract(src).catch(() => undefined);
    cache.set(src, pending);
  }
  return pending;
}

export const artworkTheme = (songId: string) => imageTheme(`/api/songs/${songId}/artwork`);

export function useImageTheme(src?: string): ArtworkTheme | undefined {
  const [theme, setTheme] = useState<{ src: string; theme?: ArtworkTheme }>();
  useEffect(() => {
    if (!src) return;
    let live = true;
    imageTheme(src).then((t) => live && setTheme({ src, theme: t }));
    return () => {
      live = false;
    };
  }, [src]);
  return theme && theme.src === src ? theme.theme : undefined;
}

export function useArtworkTheme(songId?: string): ArtworkTheme | undefined {
  return useImageTheme(songId ? `/api/songs/${songId}/artwork` : undefined);
}

async function extract(src: string): Promise<ArtworkTheme | undefined> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();

  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Weight saturated pixels more, so a mostly-white cover with a red logo
  // still reads as red, but keep some weight on everything so greyscale
  // covers stay grey rather than picking up noise.
  let r = 0, g = 0, b = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const weight = 0.15 + saturation * saturation;
    r += pr * weight;
    g += pg * weight;
    b += pb * weight;
    total += weight;
  }
  const [cr, cg, cb] = [r / total, g / total, b / total].map(Math.round);

  const light = relativeLuminance(cr, cg, cb) > 0.4;
  const deep = [cr, cg, cb].map((c) => Math.round(c * 0.38 + 14));
  return {
    color: `rgb(${cr} ${cg} ${cb})`,
    deep: `rgb(${deep.join(" ")})`,
    ink: light ? "#151412" : "#f7f5f2",
    inkMuted: light ? "rgb(21 20 18 / 0.68)" : "rgb(247 245 242 / 0.72)",
    light,
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
