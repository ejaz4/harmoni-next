"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { PlaylistSummary } from "@/server/library/service";
import type { SongResult } from "@/server/library/song-view";
import { useToast } from "./toast";

interface LibraryApi {
  isLiked(songId: string): boolean;
  toggleLike(song: SongResult): void;
  playlists: PlaylistSummary[];
  refreshPlaylists(): Promise<void>;
  createPlaylist(name: string): Promise<string | undefined>;
  addToPlaylist(playlist: { id: string; name: string }, song: SongResult): Promise<void>;
  // Bumped whenever likes or playlists change, so pages can refetch.
  version: number;
}

const LibraryContext = createContext<LibraryApi | null>(null);

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [version, setVersion] = useState(0);

  const refreshPlaylists = useCallback(async () => {
    setPlaylists(await api<PlaylistSummary[]>("/api/playlists"));
  }, []);

  useEffect(() => {
    api<string[]>("/api/likes?ids=1").then((ids) => setLiked(new Set(ids)), () => {});
    api<PlaylistSummary[]>("/api/playlists").then(setPlaylists, () => {});
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
      version,
    }),
    [liked, toggleLike, playlists, refreshPlaylists, toast, version],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}
