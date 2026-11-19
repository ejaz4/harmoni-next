import { inkFor } from "@/lib/profile-style";
import styles from "./profile.module.css";

// Someone's picture, or their initial on their colour.
// Without a size, the className sizes it.
export function Avatar({ name, url, accent, size, className }: { name: string; url?: string; accent?: string; size?: number; className?: string }) {
  const bg = accent ?? "var(--surface-3)";
  return (
    <span
      className={`${styles.avatar} ${className ?? ""}`}
      style={{ ...(size && { width: size, height: size, fontSize: size * 0.42 }), background: url ? undefined : bg, color: accent ? inkFor(accent) : undefined }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- already resized to fit when uploaded */}
      {url ? <img src={url} alt="" /> : name.slice(0, 1).toUpperCase() || "·"}
    </span>
  );
}
