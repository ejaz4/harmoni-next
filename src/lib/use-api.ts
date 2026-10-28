"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Loads a JSON endpoint; refetches when the path or `version` changes.
export function useApi<T>(path: string | undefined, version = 0) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>();
  const [reloads, setReloads] = useState(0);
  const key = `${path}|${version}|${reloads}`;

  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then(
      (data) => live && setState({ key, data }),
      (err: Error) => live && setState({ key, error: err.message }),
    );
    return () => {
      live = false;
    };
  }, [path, key]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  // Keep showing the last data while a refetch is in flight.
  const current = state?.key === key ? state : undefined;
  return { data: current?.data ?? state?.data, error: current?.error, loading: !current, reload };
}
