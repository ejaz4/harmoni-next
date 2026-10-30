"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

export function Section({ title, link, action, children }: { title: string; link?: { href: string; label: string }; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {link && (
          <Link className={styles.sectionLink} href={link.href}>
            {link.label}
          </Link>
        )}
        {action}
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
  checked?: boolean; // a tick at the end, for picking one of several
  keepOpen?: boolean; // stays open after picking, to pick something else too
}

// A small popover menu behind a "more" button. Closes on outside click,
// Escape, or picking an item.
// `text` shows a small labelled button instead of the icon alone. `open`
// and `onOpenChange` let the owner open it too (holding a song row).
export function Menu({
  items,
  label = "More",
  up,
  icon = "more",
  text,
  open: openProp,
  onOpenChange,
}: {
  items: MenuItem[];
  label?: string;
  up?: boolean;
  icon?: IconName;
  text?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const [sub, setSub] = useState<MenuItem["submenu"]>();
  const setOpen = useCallback(
    (next: boolean) => {
      if (!next) setSub(undefined);
      setOwnOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
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
  }, [open, setOpen]);

  const shown = sub?.items ?? items;
  const toggle = () => setOpen(!open);
  return (
    <div className={styles.menuWrap} ref={wrap} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {text ? (
        <button type="button" className={`${styles.button} ${styles.buttonSmall}`} aria-label={label} aria-expanded={open} onClick={toggle}>
          <Icon name={icon} /> {text}
        </button>
      ) : (
        <IconButton icon={icon} label={label} onClick={toggle} />
      )}
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
                  if (!item.keepOpen) setOpen(false);
                }}
                {...(item.checked !== undefined && { role: "menuitemradio", "aria-checked": item.checked })}
              >
                {item.icon && <Icon name={item.icon} />} {item.label}
                {item.checked && <Icon name="check" className={styles.menuCheck} />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
