"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { SpiceCard } from "@/server/discovery/spice";
import type { PlaylistSummary } from "@/server/library/service";
import type { SongResult } from "@/server/library/song-view";
import { useRouter } from "next/navigation";
import { usePrompt } from "./prompt";
import { useToast } from "./toast";

interface LibraryApi {
  isLiked(songId: string): boolean;
  toggleLike(song: SongResult): void;
  playlists: PlaylistSummary[];
  refreshPlaylists(): Promise<void>;
  createPlaylist(name: string): Promise<string | undefined>;
  addToPlaylist(playlist: { id: string; name: string }, song: SongResult): Promise<void>;
  spices: SpiceCard[]; // your own
  // Playlists and Spices together, most recently changed first, the way the library shows them.
  collections: Collection[];
  refreshSpices(): Promise<void>;
  createSpice(name: string, seed?: SongResult): Promise<string | undefined>;
  addToSpice(spice: { id: string; name: string }, song: SongResult): Promise<void>;
  // Bumped whenever likes or playlists change, so pages can refetch.
  version: number;
}

export type Collection = { type: "playlist"; playlist: PlaylistSummary } | { type: "spice"; spice: SpiceCard };

const LibraryContext = createContext<LibraryApi | null>(null);

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}

export const SPICE_NOTE = "A playlist that fills itself. Add a few seed songs and a fresh mix grows from them every day.";

// Asks for a name, makes the playlist or Spice, and opens it.
export function useNewCollection() {
  const library = useLibrary();
  const prompt = usePrompt();
  const router = useRouter();
  return {
    async newPlaylist() {
      const name = await prompt({ title: "New playlist", label: "Name it", confirm: "Create" });
      const id = name && (await library.createPlaylist(name));
      if (id) router.push(`/playlist/${id}`);
    },
    async newSpice() {
      const name = await prompt({ title: "New Spice", note: SPICE_NOTE, label: "Name it", confirm: "Create" });
      const id = name && (await library.createSpice(name));
      if (id) router.push(`/spice/${id}`);
    },
  };
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [spices, setSpices] = useState<SpiceCard[]>([]);
  const [version, setVersion] = useState(0);

  const refreshPlaylists = useCallback(async () => {
    setPlaylists(await api<PlaylistSummary[]>("/api/playlists"));
  }, []);

  const refreshSpices = useCallback(async () => {
    setSpices(await api<SpiceCard[]>("/api/spices"));
  }, []);

  useEffect(() => {
    api<string[]>("/api/likes?ids=1").then((ids) => setLiked(new Set(ids)), () => {});
    api<PlaylistSummary[]>("/api/playlists").then(setPlaylists, () => {});
    api<SpiceCard[]>("/api/spices").then(setSpices, () => {});
  }, []);

  const toggleLike = useCallback(
    (song: SongResult) => {
      const wasLiked = liked.has(song.id);
      // Optimistic: the heart fills straight away, and reverts if saving fails.
      const flip = (on: boolean) =>
        setLiked((prev) => {
          const next = new Set(prev);
          if (on) next.add(song.id);
          else next.delete(song.id);
          return next;
        });
      flip(!wasLiked);
      api<{ songId: string }>(`/api/likes/${song.id}`, { method: wasLiked ? "DELETE" : "PUT" }).then(
        ({ songId }) => {
          // The song may have been merged into another while saving.
          if (songId !== song.id) setLiked((prev) => new Set([...prev, ...(wasLiked ? [] : [songId])]));
          setVersion((v) => v + 1);
        },
        () => {
          flip(wasLiked);
          toast("Couldn't save that. Try again?", "error");
        },
      );
    },
    [liked, toast],
  );

  const collections = useMemo(() => {
    const all: Collection[] = [...playlists.map((playlist) => ({ type: "playlist" as const, playlist })), ...spices.map((spice) => ({ type: "spice" as const, spice }))];
    const at = (c: Collection) => new Date(c.type === "playlist" ? c.playlist.updatedAt : c.spice.updatedAt).getTime();
    return all.sort((a, b) => at(b) - at(a));
  }, [playlists, spices]);

  const value = useMemo<LibraryApi>(
    () => ({
      isLiked: (id) => liked.has(id),
      toggleLike,
      playlists,
      refreshPlaylists,
      async createPlaylist(name) {
        try {
          const { id } = await api<{ id: string }>("/api/playlists", { method: "POST", json: { name } });
          await refreshPlaylists();
          setVersion((v) => v + 1);
          return id;
        } catch {
          toast("Couldn't create the playlist.", "error");
        }
      },
      async addToPlaylist(playlist, song) {
        try {
          await api(`/api/playlists/${playlist.id}/items`, { method: "POST", json: { songId: song.id } });
          toast(`Added to ${playlist.name}`);
          await refreshPlaylists();
          setVersion((v) => v + 1);
        } catch {
          toast("Couldn't add that song.", "error");
        }
      },
      spices,
      collections,
      refreshSpices,
      async createSpice(name, seed) {
        try {
          const { id } = await api<SpiceCard>("/api/spices", { method: "POST", json: { name, seedId: seed?.id } });
          await refreshSpices();
          setVersion((v) => v + 1);
          return id;
        } catch {
          toast("Couldn't create the Spice.", "error");
        }
      },
      async addToSpice(spice, song) {
        try {
          await api(`/api/spices/${spice.id}/seeds`, { method: "POST", json: { songId: song.id } });
          toast(`Added to ${spice.name}`);
          await refreshSpices();
          setVersion((v) => v + 1);
        } catch {
          toast("Couldn't add that song.", "error");
        }
      },
      version,
    }),
    [liked, toggleLike, playlists, refreshPlaylists, spices, collections, refreshSpices, toast, version],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}
