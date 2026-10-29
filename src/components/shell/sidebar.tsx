"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense } from "react";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useSettings } from "@/components/providers/settings";
import { IconButton } from "@/components/ui";
import styles from "./shell.module.css";

function NavItem({ href, icon, label, exact, pathname }: { href: string; icon: IconName; label: string; exact?: boolean; pathname: string }) {
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={`${styles.navItem} ${active ? styles.navItemActive : ""}`} aria-current={active ? "page" : undefined} title={label}>
      <Icon name={icon} />
      <span className={styles.navItemLabel}>{label}</span>
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
  const prompt = usePrompt();
  const { settings } = useSettings();
  const router = useRouter();

  async function newSpice() {
    const name = await prompt({ title: "New Spice", label: "Name it", confirm: "Create" });
    if (!name) return;
    const id = await library.createSpice(name);
    if (id) router.push(`/spice/${id}`);
  }

  async function newPlaylist() {
    const name = await prompt({ title: "New playlist", label: "Name it", confirm: "Create" });
    if (!name) return;
    const id = await library.createPlaylist(name);
    if (id) router.push(`/playlist/${id}`);
  }

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
          Spices
          <IconButton icon="plus" label="New Spice" onClick={newSpice} />
        </div>
        {library.spices.length === 0 && <p className={styles.navEmpty}>Mixes that grow from songs you pick.</p>}
        {library.spices.map((s) => (
          <NavItem key={s.id} pathname={pathname} href={`/spice/${s.id}`} icon="spice" label={s.name} />
        ))}
        <div className={styles.navHeading} style={{ marginTop: 18 }}>
          Playlists
          <IconButton icon="plus" label="New playlist" onClick={newPlaylist} />
        </div>
        {library.playlists.length === 0 && <p className={styles.navEmpty}>Nothing yet. Make one with +.</p>}
        {library.playlists.map((p) => (
          <NavItem key={p.id} pathname={pathname} href={`/playlist/${p.id}`} icon="playlist" label={p.name} />
        ))}
      </div>
    </nav>
  );
}
