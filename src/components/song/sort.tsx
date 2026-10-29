"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { IconName } from "@/components/icon";
import { Menu, type MenuItem } from "@/components/ui";
import { sortItems, type SongSort, type SortField } from "@/lib/sort-songs";

// Sorting for playlists, Liked Songs and Spices. "order" is the list's own
// order (when songs were added, or how a Spice ranked them); remembered per
// list on this device.

export { sortItems, type SongSort, type SortField };

const STORAGE_KEY = "harmoni:sort";
const CHANGED = "harmoni:sort-changed";

let cached: { raw: string | null; value: Record<string, SongSort> } = { raw: null, value: {} };
function readAll(): Record<string, SongSort> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return cached.value;
  }
  if (raw !== cached.raw) {
    try {
      cached = { raw, value: JSON.parse(raw ?? "{}") as Record<string, SongSort> };
    } catch {
      cached = { raw, value: {} };
    }
  }
  return cached.value;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

const NONE = {};

// `list` names the list ("playlist:<id>"); `initial` is how it sorts until changed.
export function useSongSort(list: string, initial: SongSort): [SongSort, (sort: SongSort) => void] {
  const saved = useSyncExternalStore(subscribe, readAll, () => NONE as Record<string, SongSort>)[list];
  const set = useCallback(
    (sort: SongSort) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [list]: sort }));
      } catch {}
      window.dispatchEvent(new Event(CHANGED));
    },
    [list],
  );
  return [saved ?? initial, set];
}

const FIELDS = { title: { label: "Title", icon: "music" }, artist: { label: "Artist", icon: "user" } } as const;

export function SortMenu({
  sort,
  onChange,
  orderLabel = "Date added",
  orderIcon = "history",
}: {
  sort: SongSort;
  onChange: (sort: SongSort) => void;
  orderLabel?: string;
  orderIcon?: IconName;
}) {
  const label = (field: SortField) => (field === "order" ? orderLabel : FIELDS[field].label);
  const items: MenuItem[] = [
    ...(["order", "title", "artist"] as const).map((field) => ({
      label: label(field),
      icon: field === "order" ? orderIcon : FIELDS[field].icon,
      checked: sort.field === field,
      keepOpen: true,
      onSelect: () => onChange({ ...sort, field }),
    })),
    { divider: true, label: "" },
    { label: "Ascending", icon: "arrow-up", checked: !sort.descending, keepOpen: true, onSelect: () => onChange({ ...sort, descending: false }) },
    { label: "Descending", icon: "arrow-down", checked: sort.descending, keepOpen: true, onSelect: () => onChange({ ...sort, descending: true }) },
  ];
  return (
    <Menu
      items={items}
      text={label(sort.field)}
      icon={sort.descending ? "arrow-down" : "arrow-up"}
      label={`Sort by ${label(sort.field)}, ${sort.descending ? "descending" : "ascending"}`}
    />
  );
}
