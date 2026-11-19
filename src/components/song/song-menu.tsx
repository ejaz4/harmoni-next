"use client";

import { useRouter } from "next/navigation";
import { usePlayer } from "@/components/player/player";
import { useLibrary, useNewCollection } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { useRefreshUser, useUser } from "@/components/providers/user";
import { api } from "@/lib/api";
import { PINNED_MAX } from "@/lib/profile-style";
import { canShare, copyLink, shareLink, songPath } from "@/lib/share";
import { Menu, type MenuItem } from "@/components/ui";
import type { SongResult } from "@/server/library/song-view";

// The "more" menu every song gets: queueing, playlists, and where it's from.
export function SongMenu({
  song,
  extra,
  up,
  open,
  onOpenChange,
}: {
  song: SongResult;
  extra?: MenuItem[];
  up?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const player = usePlayer();
  const library = useLibrary();
  const toast = useToast();
  const prompt = usePrompt();
  const router = useRouter();
  const { newSpice } = useNewCollection();
  const artist = song.artists.find((a) => a.id);
  const user = useUser();
  const refreshUser = useRefreshUser();
  const pinned = user?.pinned.includes(song.id) ?? false;

  async function pin() {
    if (!pinned && (user?.pinned.length ?? 0) >= PINNED_MAX) return toast(`Your profile shows ${PINNED_MAX} songs. Take one off first.`, "error");
    try {
      await api(`/api/me/profile/pins/${song.id}`, { method: pinned ? "DELETE" : "PUT" });
      refreshUser();
      toast(pinned ? "Taken off your profile" : "On display on your profile");
    } catch {
      toast("Couldn't change your profile.", "error");
    }
  }

  const items: MenuItem[] = [
    { label: "Play next", icon: "next", onSelect: () => (player.playNext(song), toast(`${song.title} plays next`)) },
    { label: "Add to queue", icon: "queue", onSelect: () => (player.addToQueue(song), toast("Added to your queue")) },
    {
      label: "Add to playlist",
      icon: "playlist",
      submenu: {
        label: "Add to playlist",
        items: [
          {
            label: "New playlist…",
            icon: "plus",
            onSelect: async () => {
              const name = await prompt({ title: "New playlist", label: "Name it", defaultValue: `${song.title} vibes`, confirm: "Create" });
              if (!name) return;
              const id = await library.createPlaylist(name);
              if (id) await library.addToPlaylist({ id, name }, song);
            },
          },
          {
            label: "New Spice…",
            icon: "spice",
            // Opens the picker with this song in, to add more or make it straight away.
            onSelect: () => newSpice([song]),
          },
          ...(library.collections.length ? [{ divider: true, label: "" }] : []),
          // Adding to a Spice makes the song one of its seeds.
          ...library.collections.map((c): MenuItem =>
            c.type === "playlist"
              ? { label: c.playlist.name, icon: "playlist", onSelect: () => void library.addToPlaylist(c.playlist, song) }
              : { label: c.spice.name, icon: "spice", onSelect: () => void library.addToSpice(c.spice, song) },
          ),
        ],
      },
    },
    { divider: true, label: "" },
    {
      label: library.isLiked(song.id) ? "Remove from Liked" : "Add to Liked",
      icon: library.isLiked(song.id) ? "heart-solid" : "heart",
      onSelect: () => library.toggleLike(song),
    },
    { label: pinned ? "Take off your profile" : "Show on your profile", icon: pinned ? "pin-solid" : "pin", onSelect: pin },
    { divider: true, label: "" },
    {
      label: "Copy link",
      icon: "copy",
      onSelect: () => void copyLink(songPath(song.id)).then((ok) => (ok ? toast("Link copied") : toast("Couldn't copy the link.", "error"))),
    },
    ...(canShare() ? [{ label: "Share…", icon: "share" as const, onSelect: () => void shareLink(songPath(song.id), song.title) }] : []),
    { divider: true, label: "" },
    ...(song.album?.id ? [{ label: "Go to album", icon: "disc" as const, onSelect: () => router.push(`/album/${song.album!.id}`) }] : []),
    ...(artist ? [{ label: `Go to ${artist.name}`, icon: "user" as const, onSelect: () => router.push(`/artist/${artist.id}`) }] : []),
    ...(extra?.length ? [{ divider: true, label: "" }, ...extra] : []),
  ];
  return <Menu items={items} label={`More options for ${song.title}`} up={up} open={open} onOpenChange={onOpenChange} />;
}
