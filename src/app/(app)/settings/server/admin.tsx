"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useToast } from "@/components/providers/toast";
import { useRefreshUser, useUser } from "@/components/providers/user";
import { EmptyState } from "@/components/ui";
import type { AdminSettings } from "@/lib/admin";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { SettingsPage, settingsStyles as s } from "../parts";

// The server's settings, loaded once for every Server page in Settings.
// Admins only (the API checks too).

export type Patch = Partial<Omit<AdminSettings, "keys" | "providers" | "needKeys" | "features">> & {
  features?: Partial<AdminSettings["features"]>;
  keys?: Record<string, string>;
};

export type Save = (patch: Patch, done?: string) => Promise<void>;

const AdminContext = createContext<{ settings?: AdminSettings; failed: boolean; save: Save } | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const user = useUser();
  const toast = useToast();
  const refreshUser = useRefreshUser();
  const admin = user?.role === "admin";
  const { data: loaded, error } = useApi<AdminSettings>(admin ? "/api/admin/settings" : undefined);
  const [changed, setChanged] = useState<AdminSettings>();
  const settings = changed ?? loaded;

  // Shows the change at once; puts it back if the server says no.
  const save = useCallback<Save>(
    async (patch, done) => {
      const before = settings;
      if (before) setChanged({ ...before, ...patch, features: { ...before.features, ...patch.features }, keys: before.keys } as AdminSettings);
      try {
        setChanged(await api<AdminSettings>("/api/admin/settings", { method: "PATCH", json: patch }));
        if (done) toast(done);
        if (patch.name !== undefined || patch.features || patch.signups || patch.invitesBy || patch.inviteDays !== undefined) refreshUser();
      } catch {
        setChanged(before);
        toast("Couldn't save that. Try again.", "error");
      }
    },
    [settings, toast, refreshUser],
  );

  if (user && !admin) {
    return <EmptyState icon="server" title="Admins only" body="Server settings are only available to admins." />;
  }
  return <AdminContext.Provider value={{ settings, failed: !!error && !settings, save }}>{children}</AdminContext.Provider>;
}

function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin outside AdminProvider");
  return value;
}

// A Server page that needs the settings: shows them once they've loaded.
export function AdminPage({ title, description, children }: { title: string; description?: ReactNode; children: (settings: AdminSettings, save: Save) => ReactNode }) {
  const { settings, failed, save } = useAdmin();
  return (
    <SettingsPage title={title} description={description}>
      {settings ? children(settings, save) : failed ? <p className={s.empty}>Couldn&apos;t load the server settings.</p> : <div className={s.loadingCard} />}
    </SettingsPage>
  );
}
