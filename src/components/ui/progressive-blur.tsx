import styles from "./progressive-blur.module.css";

// Blur that strengthens towards one edge, the way iOS softens content
// sliding under its bars. Stacked layers each blur twice as hard as the last
// and are masked to overlapping bands, so there's no line where it starts.
const LAYERS = 5;

export function ProgressiveBlur({ edge, className }: { edge: "top" | "bottom"; className?: string }) {
  // The gradient runs from the soft end to the strong edge.
  const direction = edge === "top" ? "to top" : "to bottom";
  const band = 100 / (LAYERS + 1);
  return (
    <div className={`${styles.blur} ${className ?? ""}`} data-edge={edge} aria-hidden>
      {Array.from({ length: LAYERS }, (_, i) => {
        const stops = [i, i + 1, i + 2, i + 3].map((n) => `${Math.min(100, n * band)}%`);
        const last = i === LAYERS - 1;
        const mask = `linear-gradient(${direction}, transparent ${stops[0]}, #000 ${stops[1]}${last ? "" : `, #000 ${stops[2]}, transparent ${stops[3]}`})`;
        return (
          <div
            key={i}
            className={styles.layer}
            style={{ "--radius": `calc(var(--blur-max, 24px) / ${2 ** (LAYERS - 1 - i)})`, maskImage: mask, WebkitMaskImage: mask } as React.CSSProperties}
          />
        );
      })}
      <div className={styles.tint} />
    </div>
  );
}
