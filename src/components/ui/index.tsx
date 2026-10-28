"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import styles from "./ui.module.css";

export { Artwork } from "./artwork";
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

export function PlayButton({ playing, onClick, label, className }: { playing?: boolean; onClick: (e: React.MouseEvent) => void; label?: string; className?: string }) {
  return (
    <button type="button" className={`${styles.playButton} ${className ?? ""}`} onClick={onClick} aria-label={label ?? (playing ? "Pause" : "Play")}>
      <Icon name={playing ? "pause" : "play"} />
    </button>
  );
}

export function Section({ title, link, children }: { title: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {link && (
          <Link className={styles.sectionLink} href={link.href}>
            {link.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyBody}>{body}</p>
      {action}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  href?: string;
  // Items shown instead of the menu when picked (e.g. a playlist picker).
  submenu?: { label: string; items: MenuItem[] };
  divider?: boolean;
}

// A small popover menu behind a "more" button. Closes on outside click,
// Escape, or picking an item.
export function Menu({ items, label = "More", up, icon = "more" }: { items: MenuItem[]; label?: string; up?: boolean; icon?: IconName }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<MenuItem["submenu"]>();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = sub?.items ?? items;
  return (
    <div className={styles.menuWrap} ref={wrap} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <IconButton
        icon={icon}
        label={label}
        onClick={() => {
          setSub(undefined);
          setOpen((o) => !o);
        }}
      />
      {/* Phones show the menu as a sheet over a dimmed page. */}
      {open && <div className={styles.menuBackdrop} onClick={() => setOpen(false)} aria-hidden />}
      {open && (
        <div className={`${styles.menu} ${up ? styles.menuUp : ""}`} role="menu">
          {sub && (
            <>
              <button type="button" className={styles.menuItem} onClick={() => setSub(undefined)} role="menuitem">
                <Icon name="arrow-left" /> {sub.label}
              </button>
              <div className={styles.menuDivider} />
            </>
          )}
          {shown.map((item, i) =>
            item.divider ? (
              <div key={i} className={styles.menuDivider} />
            ) : item.href ? (
              <Link key={i} href={item.href} className={styles.menuItem} role="menuitem" onClick={() => setOpen(false)}>
                {item.icon && <Icon name={item.icon} />} {item.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                className={styles.menuItem}
                role="menuitem"
                onClick={() => {
                  if (item.submenu) return setSub(item.submenu);
                  item.onSelect?.();
                  setOpen(false);
                }}
              >
                {item.icon && <Icon name={item.icon} />} {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
