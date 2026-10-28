"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import styles from "./ui.module.css";

// Cover art with a quiet placeholder when there's none (or it fails to load).
export function Artwork({
  src,
  alt = "",
  size,
  radius = "md",
  className,
}: {
  src?: string;
  alt?: string;
  size?: number;
  radius?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: `var(--radius-${radius})` };
  if (!src || failed) {
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
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
