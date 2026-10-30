"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { Me, ServerInfo } from "@/lib/me";

type Preferences = Partial<Pick<Me, "superProcessing" | "autoplay" | "name">>;

const UserContext = createContext<{ user: Me | null; updatePreferences(p: Preferences): Promise<void>; refresh(): void } | null>(null);

// The signed-in person, or null while loading. api() sends signed-out
// visitors to /login.
export function useUser(): Me | null {
  return useContext(UserContext)?.user ?? null;
}

// What the server they're on allows, once known.
export function useServer(): ServerInfo | null {
  return useUser()?.server ?? null;
}

// Loads the person (and the server's settings) again, after an admin changes them.
export function useRefreshUser(): () => void {
  return useContext(UserContext)?.refresh ?? (() => {});
}

// Saves account preferences, showing the change straight away and putting
// it back if saving fails.
export function useUpdatePreferences(): (p: Preferences) => Promise<void> {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUpdatePreferences must be used inside <UserProvider>");
  return ctx.updatePreferences;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api<Me>("/api/me").then(setUser, () => {});
  }, [version]);

  const updatePreferences = useCallback(async (p: Preferences) => {
    let before: Me | null = null;
    setUser((u) => {
      before = u;
      return u && { ...u, ...p };
    });
    try {
      setUser(await api<Me>("/api/me", { method: "PATCH", json: p }));
    } catch (err) {
      setUser(before);
      throw err;
    }
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ user, updatePreferences, refresh }), [user, updatePreferences, refresh]);
  return <UserContext value={value}>{children}</UserContext>;
}
