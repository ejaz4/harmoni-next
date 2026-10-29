"use client";

import { useId } from "react";
import styles from "./spice-art.module.css";

// A Spice's cover: the colours of what's inside, blurred to a haze and
// ground into powder with two layers of noise, fine grain and coarse
// specks. No two names share colours.
export function SpiceArt({ name, covers = [], label = true, className }: { name: string; covers?: string[]; label?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const hash = hashName(name);
  const style = { "--spice-a": `${hash % 360}`, "--spice-b": `${(hash % 360) + 40 + ((hash >>> 9) % 90)}` } as React.CSSProperties;

  return (
    <div className={`${styles.art} ${className ?? ""}`} style={style} aria-hidden>
      {covers.slice(0, 2).map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className={i ? styles.coverB : styles.coverA} />
      ))}
      <div className={styles.tint} />
      <svg className={styles.grain} viewBox="0 0 120 120" preserveAspectRatio="none">
        <filter id={`g${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          {/* Pushed contrast: the grain reads as grit, not haze. */}
          <feComponentTransfer>
            <feFuncR type="linear" slope="2.4" intercept="-0.7" />
            <feFuncG type="linear" slope="2.4" intercept="-0.7" />
            <feFuncB type="linear" slope="2.4" intercept="-0.7" />
          </feComponentTransfer>
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${id})`} />
      </svg>
      <svg className={styles.powder} viewBox="0 0 160 160" preserveAspectRatio="none">
        <filter id={`p${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed={hash % 97} stitchTiles="stitch" />
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2 0 0 0 -0.75" />
          <feComponentTransfer>
            <feFuncA type="discrete" tableValues="0 0 0 0 0 0.5 1 1" />
          </feComponentTransfer>
        </filter>
        <rect width="100%" height="100%" filter={`url(#p${id})`} />
      </svg>
      {label && (
        <div className={styles.label}>
          <span className={styles.kicker}>Spice</span>
          <span className={styles.name}>{name}</span>
        </div>
      )}
    </div>
  );
}

function hashName(name: string): number {
  let h = 2166136261;
  for (const c of name.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
