"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { CurrentUser } from "@/server/session";

type Preferences = Partial<Pick<CurrentUser, "superProcessing" | "autoplay">>;

const UserContext = createContext<{ user: CurrentUser | null; updatePreferences(p: Preferences): Promise<void> } | null>(null);

// The signed-in person, or null while loading. api() sends signed-out
// visitors to /login.
export function useUser(): CurrentUser | null {
  return useContext(UserContext)?.user ?? null;
}

// Saves account preferences, showing the change straight away and putting
// it back if saving fails.
export function useUpdatePreferences(): (p: Preferences) => Promise<void> {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUpdatePreferences must be used inside <UserProvider>");
  return ctx.updatePreferences;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    api<CurrentUser>("/api/me").then(setUser, () => {});
  }, []);

  const updatePreferences = useCallback(async (p: Preferences) => {
    let before: CurrentUser | null = null;
    setUser((u) => {
      before = u;
      return u && { ...u, ...p };
    });
    try {
      await api("/api/me", { method: "PATCH", json: p });
    } catch (err) {
      setUser(before);
      throw err;
    }
  }, []);

  const value = useMemo(() => ({ user, updatePreferences }), [user, updatePreferences]);
  return <UserContext value={value}>{children}</UserContext>;
}
