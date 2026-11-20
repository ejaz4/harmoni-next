"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import styles from "./ui.module.css";

export { Artwork } from "./artwork";
export { ContextMenuProvider, Menu, useContextMenu, type MenuItem, type MenuItems } from "./menu";
export { styles as ui };

export function IconButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  size,
  className,
}: {
  icon: IconName;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  pressed?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${styles.iconButton} ${className ?? ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      style={size ? { fontSize: size } : undefined}
    >
      <Icon name={icon} />
    </button>
  );
}

export function PlayButton({
  playing,
  onClick,
  label,
  className,
  size = "md",
}: {
  playing?: boolean;
  onClick: (e: React.MouseEvent) => void;
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      type="button"
      className={`${styles.playButton} ${className ?? ""}`}
      data-size={size}
      data-playing={playing || undefined}
      onClick={onClick}
      aria-label={label ?? (playing ? "Pause" : "Play")}
      title={label ?? (playing ? "Pause" : "Play")}
    >
      {/* Both glyphs are there; the change crossfades instead of popping. */}
      <Icon name="play" className={styles.playGlyph} />
      <Icon name="pause" className={styles.pauseGlyph} />
    </button>
  );
}

function SectionHeader({ title, subtitle, link, children }: { title: ReactNode; subtitle?: ReactNode; link?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionHeading}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
      </div>
      {(link || children) && (
        <div className={styles.sectionTools}>
          {link && (
            <Link className={styles.sectionLink} href={link.href}>
              {link.label}
            </Link>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  link,
  action,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  link?: { href: string; label: string };
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.section} ${className ?? ""}`}>
      <SectionHeader title={title} subtitle={subtitle} link={link}>
        {action}
      </SectionHeader>
      {children}
    </section>
  );
}

// A row of cards that pages sideways: arrows in the header on desktop, a
// swipe on phones. As many columns as fit the page, never a cut-off card.
export function Shelf({
  title,
  subtitle,
  link,
  kind = "cards",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  link?: { href: string; label: string };
  kind?: "cards" | "artists" | "wide";
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth, behavior: "smooth" });
  };

  return (
    <section className={styles.section}>
      <SectionHeader title={title} subtitle={subtitle} link={link}>
        {!(edges.start && edges.end) && (
          <div className={styles.pager}>
            <IconButton icon="caret-left" label="Back" onClick={() => page(-1)} disabled={edges.start} className={styles.pagerButton} />
            <IconButton icon="caret-right" label="More" onClick={() => page(1)} disabled={edges.end} className={styles.pagerButton} />
          </div>
        )}
      </SectionHeader>
      <div className={styles.shelfFrame}>
        <div className={styles.shelf} data-kind={kind} ref={track}>
          {children}
        </div>
      </div>
    </section>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className={styles.empty}>
      {icon && (
        <span className={styles.emptyIcon}>
          <Icon name={icon} />
        </span>
      )}
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
      {action}
    </div>
  );
}
