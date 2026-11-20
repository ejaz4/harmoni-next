"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary, useNewCollection } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { collectionHref, useCollectionMenu, type CollectionRef } from "@/components/song/collection-menu";
import { SpiceArt } from "@/components/spice/spice-art";
import { DAILY_SPICE_HREF, useDailySpice } from "@/components/spice/use-daily-spice";
import { Artwork, Menu, useContextMenu } from "@/components/ui";
import { plural } from "@/lib/format";
import styles from "./shell.module.css";
import { clampWidth, COLLAPSE_BELOW, RAIL_WIDTH, setSidebarSize, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, useSidebarSize } from "./sidebar-size";

// Harmoni's mark: three soft bars, cream to peach.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="harmoni-ink" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbf1e1" />
          <stop offset="1" stopColor="#e9b99a" />
        </linearGradient>
      </defs>
      <g fill="url(#harmoni-ink)">
        <rect x="6.5" y="11.5" width="4.5" height="9" rx="2.25" />
        <rect x="13.75" y="6.5" width="4.5" height="19" rx="2.25" />
        <rect x="21" y="9.5" width="4.5" height="13" rx="2.25" />
      </g>
    </svg>
  );
}

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ href, icon, activeIcon, label, exact, pathname }: { href: string; icon: IconName; activeIcon?: IconName; label: string; exact?: boolean; pathname: string }) {
  const active = isActive(pathname, href, exact);
  return (
    <Link href={href} className={styles.navItem} aria-current={active ? "page" : undefined} title={label}>
      <Icon name={active && activeIcon ? activeIcon : icon} />
      <span className={styles.navLabel}>{label}</span>
    </Link>
  );
}

// A playlist, Spice or list in the library: its cover, its name, what it is.
function LibraryItem({
  href,
  art,
  label,
  detail,
  pathname,
  collection,
}: {
  href: string;
  art: ReactNode;
  label: string;
  detail?: string;
  pathname: string;
  collection?: CollectionRef;
}) {
  const active = isActive(pathname, href);
  const contextMenu = useContextMenu();
  const collectionMenu = useCollectionMenu();
  return (
    <Link
      href={href}
      className={styles.libraryItem}
      aria-current={active ? "page" : undefined}
      title={label}
      onContextMenu={collection ? (e) => contextMenu(e, () => collectionMenu(collection)) : undefined}
    >
      <span className={styles.libraryArt}>{art}</span>
      <span className={styles.libraryText}>
        <span className={styles.libraryLabel}>{label}</span>
        {detail && <span className={styles.libraryDetail}>{detail}</span>}
      </span>
    </Link>
  );
}

// Liked Songs, Recently Played and your Spice: a small cover-sized tile and
// a name, in the fixed part of the sidebar.
function PinnedItem({
  href,
  icon,
  tone,
  art,
  label,
  detail,
  pathname,
  collection,
}: {
  href: string;
  icon?: IconName;
  tone?: "liked" | "recent";
  art?: ReactNode;
  label: string;
  detail?: string;
  pathname: string;
  collection: CollectionRef;
}) {
  const active = isActive(pathname, href);
  const contextMenu = useContextMenu();
  const collectionMenu = useCollectionMenu();
  return (
    <Link
      href={href}
      className={`${styles.navItem} ${styles.pinnedItem}`}
      aria-current={active ? "page" : undefined}
      title={label}
      onContextMenu={(e) => contextMenu(e, () => collectionMenu(collection))}
    >
      <span className={styles.pinnedArt}>{art ?? <Tile icon={icon!} tone={tone!} />}</span>
      <span className={styles.navLabel}>{label}</span>
      {detail && <span className={styles.pinnedDetail}>{detail}</span>}
    </Link>
  );
}

function Tile({ icon, tone }: { icon: IconName; tone: "liked" | "recent" }) {
  return (
    <span className={styles.tile} data-tone={tone}>
      <Icon name={icon} />
    </span>
  );
}

// Reading the URL needs a Suspense boundary under cache components; the
// fallback is the same sidebar without the active highlight.
export function Sidebar() {
  return (
    <Suspense fallback={<SidebarNav pathname="" />}>
      <SidebarWithPath />
    </Suspense>
  );
}

function SidebarWithPath() {
  return <SidebarNav pathname={usePathname()} />;
}

function SidebarNav({ pathname }: { pathname: string }) {
  const library = useLibrary();
  const { newPlaylist, newSpice } = useNewCollection();
  const { settings } = useSettings();
  const daily = useDailySpice();
  const nav = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ top: true, bottom: true });

  // The sidebar fades at whichever end has more to scroll to.
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => setEdges({ top: el.scrollTop <= 2, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);

  return (
    <nav className={styles.sidebar} aria-label="Main" ref={nav} data-top={edges.top || undefined} data-bottom={edges.bottom || undefined}>
      <Link href="/" className={styles.brand} aria-label="Harmoni home">
        <Logo className={styles.brandMark} />
        <span className={styles.brandName}>Harmoni</span>
      </Link>

      <div className={styles.navGroup}>
        <NavItem pathname={pathname} href="/" icon="home" activeIcon="home-solid" label="Home" exact />
        <NavItem pathname={pathname} href="/search" icon="search" label="Search" />
        <NavItem pathname={pathname} href="/library" icon="library" activeIcon="library-solid" label="Your Library" exact />
        {settings.developerMode && <NavItem pathname={pathname} href="/debug" icon="settings" label="Debug" />}
      </div>

      {/* Always here, whatever else is in the library. */}
      <div className={`${styles.navGroup} ${styles.pinned}`}>
        <PinnedItem pathname={pathname} href="/liked" icon="heart-solid" tone="liked" label="Liked Songs" collection={{ kind: "liked", name: "Liked Songs" }} />
        <PinnedItem pathname={pathname} href="/recent" icon="history" tone="recent" label="Recently Played" collection={{ kind: "recent", name: "Recently Played" }} />
        {daily && (
          <PinnedItem
            pathname={pathname}
            href={DAILY_SPICE_HREF}
            art={<SpiceArt name={daily.label} label={false} />}
            label={daily.label}
            detail={daily.part}
            collection={{ kind: "spice", id: "daily", name: daily.label }}
          />
        )}
      </div>

      <div className={styles.libraryHead}>
        <Link href="/library" className={styles.libraryTitle}>
          Playlists
        </Link>
        <Menu
          icon="plus"
          label="New playlist or Spice"
          className={styles.libraryAdd}
          items={[
            { label: "New Playlist", icon: "playlist", detail: "Songs you pick, in your order", onSelect: () => void newPlaylist() },
            { label: "New Spice", icon: "spice", detail: "A mix that grows from a few songs", onSelect: () => void newSpice() },
          ]}
        />
      </div>

      <div className={styles.library}>
        {library.collections.map((c) => {
          const ref: CollectionRef = c.type === "playlist" ? { kind: "playlist", id: c.playlist.id, name: c.playlist.name } : { kind: "spice", id: c.spice.id, name: c.spice.name };
          return c.type === "playlist" ? (
            <LibraryItem
              key={c.playlist.id}
              pathname={pathname}
              href={collectionHref(ref)}
              art={<Artwork src={c.playlist.artworks[0]} radius="sm" />}
              label={c.playlist.name}
              detail={`Playlist · ${plural(c.playlist.count, "song")}`}
              collection={ref}
            />
          ) : (
            <LibraryItem
              key={c.spice.id}
              pathname={pathname}
              href={collectionHref(ref)}
              art={<SpiceArt name={c.spice.name} covers={c.spice.covers} label={false} />}
              label={c.spice.name}
              detail="Spice"
              collection={ref}
            />
          );
        })}
        {library.shared.map((p) => (
          <LibraryItem
            key={p.id}
            pathname={pathname}
            href={`/playlist/${p.id}`}
            art={<Artwork src={p.artworks[0]} radius="sm" />}
            label={p.name}
            detail={`Shared by ${p.owner.name}`}
            collection={{ kind: "playlist", id: p.id, name: p.name }}
          />
        ))}
        {library.collections.length === 0 && library.shared.length === 0 && (
          <p className={styles.libraryEmpty}>Make a playlist or a Spice with + and it&apos;ll live here.</p>
        )}
      </div>
    </nav>
  );
}

// The sidebar's edge: drag it to resize, past the narrowest width to fold
// it to a rail (and back out again), double-click for the usual width.
// Arrow keys resize it too; Enter folds it.
export function SidebarResizer() {
  const size = useSidebarSize();
  const drag = useRef<{ x: number; from: number; width: number; collapsed: boolean; shell: HTMLElement }>(undefined);

  const apply = (shell: HTMLElement, width: number, collapsed: boolean) => {
    shell.style.setProperty("--sidebar-width", `${collapsed ? RAIL_WIDTH : width}px`);
    shell.toggleAttribute("data-rail", collapsed);
  };

  return (
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={size.collapsed ? RAIL_WIDTH : size.width}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const shell = e.currentTarget.parentElement;
        if (!shell) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        shell.setAttribute("data-resizing", "");
        const from = size.collapsed ? RAIL_WIDTH : size.width;
        drag.current = { x: e.clientX, from, width: size.width, collapsed: size.collapsed, shell };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const wanted = d.from + e.clientX - d.x;
        d.collapsed = wanted < COLLAPSE_BELOW;
        if (!d.collapsed) d.width = clampWidth(wanted);
        apply(d.shell, d.width, d.collapsed);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = undefined;
        e.currentTarget.releasePointerCapture(e.pointerId);
        d.shell.removeAttribute("data-resizing");
        setSidebarSize({ width: d.width, collapsed: d.collapsed });
      }}
      onPointerCancel={() => {
        const d = drag.current;
        if (!d) return;
        drag.current = undefined;
        d.shell.removeAttribute("data-resizing");
        apply(d.shell, size.width, size.collapsed);
      }}
      onDoubleClick={() => setSidebarSize({ width: SIDEBAR_DEFAULT, collapsed: false })}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") setSidebarSize(size.collapsed ? {} : size.width - step < SIDEBAR_MIN ? { collapsed: true } : { width: size.width - step });
        else if (e.key === "ArrowRight") setSidebarSize(size.collapsed ? { collapsed: false } : { width: size.width + step });
        else if (e.key === "Enter" || e.key === " ") setSidebarSize({ collapsed: !size.collapsed });
        else return;
        e.preventDefault();
      }}
    />
  );
}
