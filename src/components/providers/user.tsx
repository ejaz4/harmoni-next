"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { CurrentUser } from "@/server/session";

const UserContext = createContext<CurrentUser | null>(null);

// The signed-in person, or null while loading. api() sends signed-out
// visitors to /login.
export function useUser(): CurrentUser | null {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    api<CurrentUser>("/api/me").then(setUser, () => {});
  }, []);
  return <UserContext value={user}>{children}</UserContext>;
}
