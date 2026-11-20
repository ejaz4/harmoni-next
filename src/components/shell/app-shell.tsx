"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { NowPlayingProvider } from "@/components/player/now-playing";
import { PlayerBar } from "@/components/player/player-bar";
import { PlayerProvider } from "@/components/player/player";
import { SidePanel, SidePanelProvider, useSidePanel } from "@/components/player/side-panel";
import { LibraryProvider } from "@/components/providers/library";
import { PromptProvider } from "@/components/providers/prompt";
import { ToastProvider } from "@/components/providers/toast";
import { UserProvider } from "@/components/providers/user";
import { ContextMenuProvider } from "@/components/ui";
import { MobileDock } from "./mobile-dock";
import { Sidebar } from "./sidebar";
import styles from "./shell.module.css";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <PromptProvider>
        <UserProvider>
          <LibraryProvider>
            <PlayerProvider>
              <ContextMenuProvider>
                <SidePanelProvider>
                  <NowPlayingProvider>
                    <Frame>{children}</Frame>
                  </NowPlayingProvider>
                </SidePanelProvider>
              </ContextMenuProvider>
            </PlayerProvider>
          </LibraryProvider>
        </UserProvider>
      </PromptProvider>
    </ToastProvider>
  );
}

// Desktop: the sidebar and player sit on the app's dark frame; the page is a
// lifted canvas between them, its content never wider than --content-max,
// with the Now Playing panel docked beside it when open.
function Frame({ children }: { children: ReactNode }) {
  const panel = useSidePanel();
  const content = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.shell} data-panel={panel.view ? true : undefined}>
      <Sidebar />
      <div className={styles.canvas}>
        <TopBar />
        <main className={styles.main} id="main">
          <div className={styles.content} ref={content}>
            {children}
          </div>
          <Suspense fallback={null}>
            <PageEnter target={content} />
          </Suspense>
        </main>
      </div>
      <SidePanel />
      <PlayerBar />
      <MobileDock />
    </div>
  );
}

// A new page settles into place: a short rise and fade, so moving between
// pages reads as arriving somewhere rather than a flash of new content.
function PageEnter({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => {
    if (pathname === last.current) return;
    last.current = pathname;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    target.current?.animate(
      [
        { opacity: 0, transform: "translateY(12px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [pathname, target]);
  return null;
}
