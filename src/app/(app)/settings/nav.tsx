"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icon";
import { Avatar } from "@/components/profile/avatar";
import { useUser } from "@/components/providers/user";
import s from "./settings.module.css";

// Settings' categories: down the side on wide screens, a page of their own
// on narrow ones.

interface Category {
  href: string;
  label: string;
  icon: IconName;
}

interface CategoryGroup {
  heading?: string;
  categories: Category[];
}

export const ACCOUNT_HREF = "/settings/account";

function useCategories(): CategoryGroup[] {
  const user = useUser();
  const features = user?.server.features;
  const groups: CategoryGroup[] = [
    {
      categories: [
        { href: ACCOUNT_HREF, label: "Account", icon: "user" },
        { href: "/settings/privacy", label: "Privacy & security", icon: "shield" },
      ],
    },
    {
      heading: "Listening",
      categories: [
        { href: "/settings/playback", label: "Playback", icon: "headphones" },
        { href: "/settings/recommendations", label: "Recommendations", icon: "lightning" },
        ...(features?.link !== false ? [{ href: "/settings/link", label: "Harmoni Link", icon: "link" as const }] : []),
        { href: "/settings/import", label: "Import music", icon: "download" },
      ],
    },
    {
      heading: "More",
      categories: [
        ...(user?.server.canInvite ? [{ href: "/settings/invites", label: "Invite people", icon: "send" as const }] : []),
        { href: "/settings/developer", label: "Developer", icon: "code" },
      ],
    },
  ];
  if (user?.role === "admin") {
    groups.push({
      heading: "Server",
      categories: [
        { href: "/settings/server", label: "Overview", icon: "pulse" },
        { href: "/settings/server/general", label: "General", icon: "adjust" },
        { href: "/settings/server/sign-ups", label: "Sign-ups", icon: "login" },
        { href: "/settings/server/people", label: "People", icon: "group" },
        { href: "/settings/server/features", label: "Features", icon: "apps" },
        { href: "/settings/server/audio", label: "Audio", icon: "volume-up" },
        { href: "/settings/server/providers", label: "Providers", icon: "cloud" },
      ],
    });
  }
  return groups;
}

// Settings' own landing page shows Account beside the list.
const isCurrent = (href: string, pathname: string) => pathname === href || (href === ACCOUNT_HREF && pathname === "/settings");

export function SettingsNav() {
  const pathname = usePathname();
  const groups = useCategories();
  const nav = useRef<HTMLElement>(null);

  // The highlight moves to the current category. Placed without sliding the
  // first time, so it doesn't fly in from the top on arrival.
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) {
      el.removeAttribute("data-indicator");
      return;
    }
    el.style.setProperty("--y", `${current.offsetTop}px`);
    el.style.setProperty("--h", `${current.offsetHeight}px`);
    if (!el.hasAttribute("data-indicator")) {
      el.setAttribute("data-indicator", "");
      requestAnimationFrame(() => el.setAttribute("data-indicator", "ready"));
    }
  });

  return (
    <nav className={s.nav} ref={nav} aria-label="Settings">
      <span className={s.indicator} aria-hidden />
      {groups.map((g) => (
        <div key={g.heading ?? "you"} className={s.navGroup}>
          {g.heading && <h2 className={s.navHeading}>{g.heading}</h2>}
          {g.categories.map((c) => (
            <Link key={c.href} href={c.href} className={s.navLink} aria-current={isCurrent(c.href, pathname) ? "page" : undefined}>
              <Icon name={c.icon} />
              {c.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

// Narrow screens: who you are at the top, then every category.
export function SettingsIndex() {
  const user = useUser();
  const groups = useCategories();
  return (
    <div className={s.index}>
      <h1 className={s.indexTitle}>Settings</h1>
      <Link href={ACCOUNT_HREF} className={s.indexProfile}>
        {user ? <Avatar name={user.name} url={user.avatarUrl} accent={user.accent} size={52} /> : <span className={s.profileAvatar} />}
        <span>
          <span className={s.profileName}>{user?.name ?? " "}</span>
          <br />
          <span className={s.profileMeta}>{user ? `@${user.username} · Account` : "Account"}</span>
        </span>
        <Icon name="caret-right" />
      </Link>
      {groups.map((g) => {
        const categories = g.categories.filter((c) => c.href !== ACCOUNT_HREF);
        return (
          <section key={g.heading ?? "you"} className={s.indexGroup}>
            {g.heading && <h2 className={s.indexHeading}>{g.heading}</h2>}
            <div className={s.card}>
              {categories.map((c) => (
                <Link key={c.href} href={c.href} className={s.indexRow}>
                  <span className={s.indexIcon}>
                    <Icon name={c.icon} />
                  </span>
                  {c.label}
                  <Icon name="caret-right" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
