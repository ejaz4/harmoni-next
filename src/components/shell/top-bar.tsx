"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { Avatar } from "@/components/profile/avatar";
import { useUser } from "@/components/providers/user";
import { Menu } from "@/components/ui";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { authClient } from "@/lib/auth-client";
import { profilePath } from "@/lib/share";
import styles from "./shell.module.css";
import { setSidebarSize, useSidebarSize } from "./sidebar-size";

// Over the top of the page: back and forward, search, and your account.
// Clear over the page's header; once the page scrolls, it frosts over.
export function TopBar() {
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    const main = document.getElementById("main");
    const el = bar.current;
    if (!main || !el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      el.toggleAttribute("data-scrolled", main.scrollTop > 4);
      // Keep clear of the page's scrollbar.
      el.style.setProperty("--scrollbar", `${main.offsetWidth - main.clientWidth}px`);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(update));
    update();
    main.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(main);
    return () => {
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <header className={styles.topbar} ref={bar}>
      <ProgressiveBlur edge="top" className={styles.topbarBlur} />
      <div className={styles.topbarInner}>
        <div className={styles.topbarStart}>
          <Link href="/" className={styles.logo}>
            Harmoni
          </Link>
          <SidebarToggle />
          <History />
        </div>
        <Suspense fallback={<div className={styles.search} />}>
          <SearchBox />
        </Suspense>
        <div className={styles.topbarEnd}>
          <Account />
        </div>
      </div>
    </header>
  );
}

// Shows or folds away the sidebar (to a rail of icons and covers).
function SidebarToggle() {
  const size = useSidebarSize();
  return (
    <button
      type="button"
      className={`${styles.roundButton} ${styles.glass} ${styles.sidebarToggle}`}
      onClick={() => setSidebarSize({ collapsed: !size.collapsed })}
      aria-pressed={!size.collapsed}
      aria-label={size.collapsed ? "Show sidebar" : "Hide sidebar"}
      title={size.collapsed ? "Show sidebar" : "Hide sidebar"}
    >
      <Icon name="sidebar" />
    </button>
  );
}

interface NavigationLike extends EventTarget {
  canGoBack?: boolean;
  canGoForward?: boolean;
}

const navigation = () => (window as unknown as { navigation?: NavigationLike }).navigation;
const subscribeNavigation = (onChange: () => void) => {
  const nav = navigation();
  // Next.js writes history from an insertion effect, where React allows no
  // updates: hear about it just after instead.
  const later = () => queueMicrotask(onChange);
  nav?.addEventListener("currententrychange", later);
  return () => nav?.removeEventListener("currententrychange", later);
};

// Back and forward, like a browser's, greyed out when there's nowhere to go
// (where the browser can tell us).
function History() {
  const router = useRouter();
  const back = useSyncExternalStore(subscribeNavigation, () => navigation()?.canGoBack ?? true, () => true);
  const forward = useSyncExternalStore(subscribeNavigation, () => navigation()?.canGoForward ?? true, () => false);
  return (
    <div className={styles.history}>
      <button type="button" className={`${styles.roundButton} ${styles.glass}`} onClick={() => router.back()} disabled={!back} aria-label="Back" title="Back">
        <Icon name="caret-left" />
      </button>
      <button type="button" className={`${styles.roundButton} ${styles.glass}`} onClick={() => router.forward()} disabled={!forward} aria-label="Forward" title="Forward">
        <Icon name="caret-right" />
      </button>
    </div>
  );
}

// Typing searches as you go once you're on the search page; Enter takes you there.
function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQuery = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  const input = useRef<HTMLInputElement>(null);

  // Follow the URL when it changes elsewhere (back button, links).
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    if (pathname !== "/search") return;
    const q = value.trim();
    if (q === urlQuery.trim()) return;
    const timer = setTimeout(() => router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search"), 450);
    return () => clearTimeout(timer);
  }, [value, pathname, urlQuery, router]);

  // "/" (or ⌘K / Ctrl+K) focuses search from anywhere, like most apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      className={styles.search}
      // Phones only show the search field on the search page itself.
      data-here={pathname === "/search" || undefined}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <label className="visually-hidden" htmlFor="global-search">
        Search
      </label>
      <Icon name="search" className={styles.searchIcon} />
      <input
        id="global-search"
        ref={input}
        className={`${styles.searchInput} ${styles.glass}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        placeholder="Songs, artists, lyrics, people"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
      />
      {!value && (
        <kbd className={styles.searchKey} aria-hidden>
          /
        </kbd>
      )}
    </form>
  );
}

function Account() {
  const user = useUser();
  const router = useRouter();
  const name = user?.name ?? "";
  const avatar = <Avatar name={name} url={user?.avatarUrl} accent={user?.accent} className={styles.avatar} />;
  return (
    <>
      {/* Phones: the avatar goes straight to your profile. */}
      <Link href={user ? profilePath(user.username) : "/settings"} className={styles.profileLink} aria-label="Your profile">
        {avatar}
      </Link>
      <Menu
        label="Account"
        className={`${styles.profile} ${styles.glass}`}
        trigger={
          <>
            {avatar}
            <span className={styles.profileName}>{name}</span>
            <Icon name="caret-down" className={styles.profileCaret} />
          </>
        }
        header={
          user && (
            <div className={styles.accountHeader}>
              <Avatar name={name} url={user.avatarUrl} accent={user.accent} size={40} />
              <span>
                <span className={styles.accountName}>{name}</span>
                <span className={styles.accountHandle}>@{user.username}</span>
              </span>
            </div>
          )
        }
        items={[
          ...(user ? [{ label: "Your profile", icon: "user" as const, href: profilePath(user.username) }] : []),
          { label: "Settings", icon: "settings", href: "/settings" },
          ...(user?.server.canInvite ? [{ label: "Invite people", icon: "ticket" as const, href: "/settings/invites" }] : []),
          ...(user?.role === "admin" ? [{ label: "Server settings", icon: "server" as const, href: "/settings/server" }] : []),
          { divider: true, label: "" },
          {
            label: "Sign out",
            icon: "logout",
            onSelect: async () => {
              await authClient.signOut();
              router.replace("/login");
              router.refresh();
            },
          },
        ]}
      />
    </>
  );
}
