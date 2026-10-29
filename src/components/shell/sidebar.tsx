"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary, useNewCollection } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { Menu } from "@/components/ui";
import styles from "./shell.module.css";

function NavItem({ href, icon, label, detail, exact, pathname }: { href: string; icon: IconName; label: string; detail?: string; exact?: boolean; pathname: string }) {
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`${styles.navItem} ${detail ? styles.navItemTall : ""} ${active ? styles.navItemActive : ""}`}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <Icon name={icon} />
      {detail ? (
        <span className={styles.navItemText}>
          <span className={styles.navItemLabel}>{label}</span>
          <span className={styles.navItemDetail}>{detail}</span>
        </span>
      ) : (
        <span className={styles.navItemLabel}>{label}</span>
      )}
    </Link>
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

  return (
    <nav className={styles.sidebar} aria-label="Main">
      <div className={styles.navGroup}>
        <div className={styles.navHeading}>Browse Music</div>
        <NavItem pathname={pathname} href="/" icon="home" label="Home" exact />
        <NavItem pathname={pathname} href="/search" icon="search" label="Search" />
      </div>
      <div className={styles.navGroup}>
        <div className={styles.navHeading}>Library</div>
        <NavItem pathname={pathname} href="/recent" icon="history" label="Recently Played" />
        <NavItem pathname={pathname} href="/liked" icon="heart" label="Liked Songs" />
        {settings.developerMode && <NavItem pathname={pathname} href="/debug" icon="settings" label="Debug" />}
      </div>
      <div className={`${styles.navGroup} ${styles.playlistNav}`}>
        <div className={styles.navHeading}>
          Playlists
          <Menu
            icon="plus"
            label="New playlist or Spice"
            items={[
              { label: "Playlist", icon: "playlist", onSelect: () => void newPlaylist() },
              { label: "Spice", icon: "spice", onSelect: () => void newSpice() },
            ]}
          />
        </div>
        {library.collections.length === 0 && <p className={styles.navEmpty}>Nothing yet. Make a playlist or a Spice with +.</p>}
        {library.collections.map((c) =>
          c.type === "playlist" ? (
            <NavItem key={c.playlist.id} pathname={pathname} href={`/playlist/${c.playlist.id}`} icon="playlist" label={c.playlist.name} detail="Playlist" />
          ) : (
            <NavItem key={c.spice.id} pathname={pathname} href={`/spice/${c.spice.id}`} icon="spice" label={c.spice.name} detail="Spice" />
          ),
        )}
      </div>
    </nav>
  );
}
