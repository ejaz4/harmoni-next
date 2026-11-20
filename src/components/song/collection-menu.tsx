"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { usePlayer } from "@/components/player/player";
import { useToast } from "@/components/providers/toast";
import type { MenuItem } from "@/components/ui";
import { api } from "@/lib/api";
import { copyLink } from "@/lib/share";
import type { SongResult } from "@/server/library/song-view";

// Something with songs in it, played from its card or menu without opening it.
export type CollectionRef =
  | { kind: "playlist"; id: string; name: string; shareable?: boolean }
  | { kind: "spice"; id: string; name: string }
  | { kind: "album"; id: string; name: string; artist?: { id: string; name: string } }
  | { kind: "liked"; name?: string }
  | { kind: "recent"; name?: string }
  | { kind: "artist"; id: string; name: string };

export const collectionHref = (c: CollectionRef) =>
  c.kind === "liked" ? "/liked" : c.kind === "recent" ? "/recent" : `/${c.kind}/${c.id}`;

const key = (c: CollectionRef) => ("id" in c ? `${c.kind}:${c.id}` : c.kind);

async function songsOf(c: CollectionRef): Promise<SongResult[]> {
  switch (c.kind) {
    case "playlist":
      return (await api<{ items: { song: SongResult }[] }>(`/api/playlists/${c.id}`)).items.map((i) => i.song);
    case "spice":
      return (await api<{ songs: SongResult[] }>(`/api/spices/${c.id}`)).songs;
    case "album":
      return (await api<{ songs: SongResult[] }>(`/api/albums/${c.id}`)).songs;
    case "artist":
      return (await api<{ popular: SongResult[] }>(`/api/artists/${c.id}`)).popular;
    case "liked":
      return api<SongResult[]>("/api/likes");
    case "recent":
      return api<SongResult[]>("/api/plays?limit=100");
  }
}

// Plays, shuffles or queues a collection's songs, fetching them first.
// `loading` names the one being fetched, so its button can say so.
export function useCollectionPlayer() {
  const player = usePlayer();
  const toast = useToast();
  const [loading, setLoading] = useState<string>();

  const run = useCallback(
    async (c: CollectionRef, how: "play" | "shuffle" | "next" | "queue" = "play") => {
      setLoading(key(c));
      try {
        const songs = await songsOf(c);
        if (!songs.length) return toast(c.kind === "spice" ? "Nothing in this Spice yet." : "Nothing to play in here yet.");
        if (how === "play") player.play(songs, 0);
        else if (how === "shuffle") player.play(songs, Math.floor(Math.random() * songs.length), { shuffle: true });
        else if (how === "next") {
          for (const song of [...songs].reverse()) player.playNext(song);
          toast(`${c.name ?? "Those songs"} play next`);
        } else {
          for (const song of songs) player.addToQueue(song);
          toast(`Added ${songs.length === 1 ? "1 song" : `${songs.length} songs`} to your queue`);
        }
      } catch {
        toast("Couldn't load those songs.", "error");
      } finally {
        setLoading(undefined);
      }
    },
    [player, toast],
  );

  return { run, loading, isLoading: (c: CollectionRef) => loading === key(c) };
}

// The menu for a playlist, Spice, album or artist card: play it in any of
// the usual ways, open it, and go where it leads.
export function useCollectionMenu() {
  const { run } = useCollectionPlayer();
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    (c: CollectionRef, extra: MenuItem[] = []): MenuItem[] => [
      { label: "Play", icon: "play", onSelect: () => void run(c) },
      { label: "Shuffle", icon: "shuffle", onSelect: () => void run(c, "shuffle") },
      { label: "Play next", icon: "next", onSelect: () => void run(c, "next") },
      { label: "Add to queue", icon: "queue", onSelect: () => void run(c, "queue") },
      { divider: true, label: "" },
      { label: `Open ${c.kind === "liked" ? "Liked Songs" : c.kind === "recent" ? "Recently Played" : c.kind}`, icon: "arrow-right", onSelect: () => router.push(collectionHref(c)) },
      ...(c.kind === "album" && c.artist ? [{ label: `Go to ${c.artist.name}`, icon: "user" as const, onSelect: () => router.push(`/artist/${c.artist!.id}`) }] : []),
      ...(c.kind === "album" || c.kind === "artist" || (c.kind === "playlist" && c.shareable)
        ? [
            { divider: true, label: "" },
            {
              label: "Copy link",
              icon: "copy" as const,
              onSelect: () => void copyLink(collectionHref(c)).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link.", ok ? "info" : "error")),
            },
          ]
        : []),
      ...(extra.length ? [{ divider: true, label: "" }, ...extra] : []),
    ],
    [run, router, toast],
  );
}
