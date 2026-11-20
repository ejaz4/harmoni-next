"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import styles from "./ui.module.css";

// Harmoni's own image routes take ?w= and send a copy that size, so a 44px
// thumbnail doesn't download a 1000px cover.
export function sizedArt(src: string, px: number): string {
  if (!/^(https?:\/\/[^/]+)?\/api\/(art|songs|artists)\//.test(src) || /[?&]w=/.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}w=${Math.round(px)}`;
}

// Cover art with a quiet placeholder when there's none (or it fails to
// load). `fallbackSrc` is tried first if `src` fails, e.g. a song cover
// standing in for an artist photo we don't have. `px` is the most pixels
// it'll be shown at (twice `size` by default, for sharp screens).
export function Artwork({
  src,
  fallbackSrc,
  alt = "",
  size,
  px,
  radius = "md",
  className,
}: {
  src?: string;
  fallbackSrc?: string;
  alt?: string;
  size?: number;
  px?: number;
  radius?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [failed, setFailed] = useState(0);
  const want = px ?? (size ? size * 2 : 512);
  const sources = [src, fallbackSrc].filter((s): s is string => !!s).map((s) => sizedArt(s, want));
  const shown = sources[failed];
  const style = { width: size, height: size, borderRadius: `var(--radius-${radius})` };
  if (!shown) {
    return (
      <div className={`${styles.artwork} ${styles.artworkEmpty} ${className ?? ""}`} style={style} role="img" aria-label={alt || undefined}>
        <Icon name="music" size="38%" />
      </div>
    );
  }
  return (
    // Covers come from many CDNs; next/image would need each one allowlisted.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`${styles.artwork} ${className ?? ""}`}
      style={style}
      key={shown}
      src={shown}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed((n) => n + 1)}
    />
  );
}
