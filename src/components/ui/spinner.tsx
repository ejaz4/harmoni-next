import styles from "./spinner.module.css";

const SPOKES = 8;

// Apple-style activity indicator: short, thick, rounded spokes that light
// up in turn around a ring. Sized by font-size, coloured by currentColor.
export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" className={`${styles.spinner} ${className ?? ""}`} role="status" aria-label={label}>
      {Array.from({ length: SPOKES }, (_, i) => (
        <line
          key={i}
          x1="12"
          y1="3.5"
          x2="12"
          y2="7.5"
          transform={`rotate(${(360 / SPOKES) * i} 12 12)`}
          // Negative delays start each spoke mid-cycle, so the ring is lit
          // from the first frame instead of fading in.
          style={{ animationDelay: `${((i - SPOKES) / SPOKES).toFixed(3)}s` }}
        />
      ))}
    </svg>
  );
}
