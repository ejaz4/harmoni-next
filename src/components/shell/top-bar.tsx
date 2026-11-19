"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { Avatar } from "@/components/profile/avatar";
import { useUser } from "@/components/providers/user";
import { Menu } from "@/components/ui";
import { ProgressiveBlur } from "@/components/ui/progressive-blur";
import { authClient } from "@/lib/auth-client";
import { profilePath } from "@/lib/share";
import styles from "./shell.module.css";

export function TopBar() {
  return (
    <header className={styles.topbar}>
      {/* Phones: the page scrolls under the bar and blurs away. */}
      <ProgressiveBlur edge="top" className={styles.topbarBlur} />
      <Link href="/" className={styles.logo}>
        Harmoni
      </Link>
      <Suspense fallback={<div className={styles.search} />}>
        <SearchBox />
      </Suspense>
      <div className={styles.spacer} />
      <Profile />
    </header>
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

  // "/" focuses search from anywhere, like most apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(target.tagName)) {
        e.preventDefault();
        input.current?.focus();
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
      <input
        id="global-search"
        ref={input}
        className={styles.searchInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search songs, artists…"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
      />
      <Icon name="search" className={styles.searchIcon} />
    </form>
  );
}

function Profile() {
  const user = useUser();
  const router = useRouter();
  const name = user?.name ?? "";
  return (
    <div className={styles.account}>
      <Link href={user ? profilePath(user.username) : "/settings"} className={styles.profile}>
        <Avatar name={name} url={user?.avatarUrl} accent={user?.accent} className={styles.avatar} />
        <span className={styles.profileName}>{name}</span>
      </Link>
      <span className={styles.accountMenu}>
        <Menu
          label="Account"
          icon="caret-down"
          items={[
            ...(user ? [{ label: "Your profile", icon: "user" as const, href: profilePath(user.username) }] : []),
            { label: "Settings", icon: "settings", href: "/settings" },
            ...(user?.server.canInvite ? [{ label: "Invite someone", icon: "ticket" as const, href: "/settings#invites" }] : []),
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
      </span>
    </div>
  );
}
