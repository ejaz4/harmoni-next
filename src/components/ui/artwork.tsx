"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import styles from "./ui.module.css";

// Cover art with a quiet placeholder when there's none (or it fails to
// load). `fallbackSrc` is tried first if `src` fails, e.g. a song cover
// standing in for an artist photo we don't have.
export function Artwork({
  src,
  fallbackSrc,
  alt = "",
  size,
  radius = "md",
  className,
}: {
  src?: string;
  fallbackSrc?: string;
  alt?: string;
  size?: number;
  radius?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [failed, setFailed] = useState(0);
  const sources = [src, fallbackSrc].filter((s): s is string => !!s);
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
