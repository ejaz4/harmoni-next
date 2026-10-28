"use client";

import type { ReactNode } from "react";
import { NowPlayingProvider } from "@/components/player/now-playing";
import { PlayerBar } from "@/components/player/player-bar";
import { PlayerProvider } from "@/components/player/player";
import { LibraryProvider } from "@/components/providers/library";
import { PromptProvider } from "@/components/providers/prompt";
import { ToastProvider } from "@/components/providers/toast";
import { UserProvider } from "@/components/providers/user";
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
              <NowPlayingProvider>
                <div className={styles.shell}>
                  <TopBar />
                  <Sidebar />
                  <main className={styles.main} id="main">
                    {children}
                  </main>
                  <PlayerBar />
                  <MobileDock />
                </div>
              </NowPlayingProvider>
            </PlayerProvider>
          </LibraryProvider>
        </UserProvider>
      </PromptProvider>
    </ToastProvider>
  );
}
