import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsNav } from "./nav";
import s from "./settings.module.css";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <div className={s.frame}>
      <h1 className={s.frameTitle}>Settings</h1>
      <div className={s.layout}>
        <aside className={s.aside}>
          <Suspense fallback={null}>
            <SettingsNav />
          </Suspense>
        </aside>
        {/* Moving between categories animates just this (see PageEnter). */}
        <div className={s.pane} data-subpage>
          {children}
        </div>
      </div>
    </div>
  );
}
