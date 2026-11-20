"use client";

import { useState } from "react";
import { usePlayer } from "@/components/player/player";
import { useToast } from "@/components/providers/toast";
import { CollectionCard } from "@/components/song/song-card";
import { api } from "@/lib/api";
import type { SpiceCard as Card, SpicePage } from "@/server/discovery/spice";
import { plural } from "@/lib/format";
import { SpiceArt } from "./spice-art";
import styles from "./spice-art.module.css";

// Playing straight from a card opens the Spice behind the scenes, which is
// what freshens it for the day.
export function usePlaySpice() {
  const player = usePlayer();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  async function play(id: string) {
    setLoading(true);
    try {
      const spice = await api<SpicePage>(`/api/spices/${id}`);
      if (spice.songs.length) player.play(spice.songs, 0);
      else toast(spice.kind === "custom" ? "Add a seed song first." : "Nothing in this Spice yet.");
    } catch {
      toast("Couldn't open that Spice.", "error");
    } finally {
      setLoading(false);
    }
  }
  return { play, loading };
}

export function SpiceCardLink({ spice }: { spice: Card }) {
  return (
    <CollectionCard
      collection={{ kind: "spice", id: spice.id, name: spice.name }}
      art={<SpiceArt name={spice.name} covers={spice.covers} className={styles.inCard} />}
      subtitle={spice.kind === "custom" ? `Spice · ${plural(spice.seedCount ?? 0, "seed")}` : "Spice · fresh daily"}
    />
  );
}
