"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Icon, type IconName } from "@/components/icon";
import { MiniPlayer } from "@/components/player/mini-player";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import styles from "./shell.module.css";

const TABS: { href: string; label: string; icon: IconName; activeIcon: IconName; match: (p: string) => boolean }[] = [
  { href: "/", label: "Home", icon: "home", activeIcon: "home-solid", match: (p) => p === "/" },
  { href: "/search", label: "Search", icon: "search", activeIcon: "search", match: (p) => p.startsWith("/search") },
  {
    href: "/library",
    label: "Library",
    icon: "library",
    activeIcon: "library-solid",
    match: (p) => ["/library", "/liked", "/recent", "/playlist"].some((r) => p === r || p.startsWith(`${r}/`)),
  },
];

// Phones only (hidden by CSS elsewhere): the mini player and tab bar,
// floating over the page with the content blurring away beneath them.
export function MobileDock() {
  return (
    <div className={styles.dock}>
      <ProgressiveBlur edge="bottom" className={styles.dockBlur} />
      <MiniPlayer />
      <Suspense fallback={<Tabs pathname="" />}>
        <TabsWithPath />
      </Suspense>
    </div>
  );
}

function TabsWithPath() {
  return <Tabs pathname={usePathname()} />;
}

// Tapping the tab you're already on, like iOS: Search focuses the search
// field (and brings up the keyboard), the others scroll back to the top.
function reselect(e: React.MouseEvent, href: string) {
  e.preventDefault();
  if (href === "/search") document.getElementById("global-search")?.focus();
  else document.getElementById("main")?.scrollTo({ top: 0, behavior: "smooth" });
}

function Tabs({ pathname }: { pathname: string }) {
  return (
    <nav className={styles.tabs} aria-label="Main">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link key={tab.href} href={tab.href} className={styles.tab} aria-current={active ? "page" : undefined} onClick={(e) => pathname === tab.href && reselect(e, tab.href)}>
            <Icon name={active ? tab.activeIcon : tab.icon} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
