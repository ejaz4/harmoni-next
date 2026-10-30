"use client";

import { useEffect, useState } from "react";

export interface Setup {
  needsAdmin: boolean;
  name: string;
  welcome: string;
  signups: "invite" | "open" | "closed";
}

// What this server is called and who can join (public: /api/setup).
export function useSetup(): Setup | undefined {
  const [setup, setSetup] = useState<Setup>();
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d: Setup) => setSetup(d))
      .catch(() => setSetup({ needsAdmin: false, name: "Harmoni", welcome: "", signups: "invite" }));
  }, []);
  return setup;
}
