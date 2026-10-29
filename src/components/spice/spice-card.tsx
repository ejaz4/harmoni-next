"use client";

import Link from "next/link";
import { useState } from "react";
import { usePlayer } from "@/components/player/player";
import { useToast } from "@/components/providers/toast";
import { PlayButton, ui } from "@/components/ui";
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
  const { play, loading } = usePlaySpice();
  return (
    <Link href={`/spice/${spice.id}`} className={ui.card}>
      <div className={`${ui.cardArt} ${styles.cardArt}`}>
        <SpiceArt name={spice.name} covers={spice.covers} />
        <PlayButton
          className={ui.cardPlay}
          playing={loading}
          label={`Play ${spice.name}`}
          onClick={(e) => {
            e.preventDefault();
            void play(spice.id);
          }}
        />
      </div>
      <span className={ui.cardTitle}>{spice.name}</span>
      <span className={ui.cardSubtitle}>{spice.kind === "custom" ? `Spice · ${plural(spice.seedCount ?? 0, "seed")}` : "Spice · fresh daily"}</span>
    </Link>
  );
}
