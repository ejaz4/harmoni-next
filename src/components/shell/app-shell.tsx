"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { NowPlayingProvider } from "@/components/player/now-playing";
import { PlayerBar } from "@/components/player/player-bar";
import { PlayerProvider } from "@/components/player/player";
import { SidePanel, SidePanelProvider, useSidePanel } from "@/components/player/side-panel";
import { LibraryProvider } from "@/components/providers/library";
import { PromptProvider } from "@/components/providers/prompt";
import { ToastProvider } from "@/components/providers/toast";
import { UserProvider } from "@/components/providers/user";
import { ContextMenuProvider } from "@/components/ui";
import { useMediaQuery } from "@/lib/use-media-query";
import { MobileDock } from "./mobile-dock";
import { Sidebar, SidebarResizer } from "./sidebar";
import { RAIL_WIDTH, useSidebarSize } from "./sidebar-size";
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
  const shell = useRef<HTMLDivElement>(null);
  const size = useSidebarSize();
  const narrow = useMediaQuery("(max-width: 900px)");
  const rail = size.collapsed || narrow;

  // The sidebar's width goes straight onto the frame (dragging its edge
  // writes it there too, without re-rendering anything).
  useLayoutEffect(() => {
    const el = shell.current;
    if (!el) return;
    el.style.setProperty("--sidebar-width", `${rail ? RAIL_WIDTH : size.width}px`);
    el.toggleAttribute("data-rail", rail);
  }, [rail, size.width]);

  // Changes animate only after the first paint on the saved sizes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => shell.current?.setAttribute("data-ready", ""));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={styles.shell} ref={shell} data-panel={panel.view ? true : undefined}>
      <Sidebar />
      <SidebarResizer />
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
// Within Settings only the page beside the categories moves (data-subpage),
// and less, so the categories stay put.
const section = (path: string) => (path.startsWith("/settings") ? "/settings" : path);

function PageEnter({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname();
  const last = useRef(pathname);
  useEffect(() => {
    if (pathname === last.current) return;
    const within = section(pathname) === section(last.current);
    last.current = pathname;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = within ? target.current?.querySelector("[data-subpage]") : target.current;
    el?.animate(
      [
        { opacity: 0, transform: `translateY(${within ? 6 : 12}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: within ? 380 : 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [pathname, target]);
  return null;
}
