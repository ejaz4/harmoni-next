"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ShareSheet, type Sharing } from "@/components/profile/share-sheet";
import { useLibrary } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { findItems, useFind } from "@/components/song/find";
import { SongList } from "@/components/song/song-list";
import { SortMenu, sortItems, useSongSort } from "@/components/song/sort";
import { Artwork, EmptyState, IconButton, Menu, type MenuItem } from "@/components/ui";
import { api } from "@/lib/api";
import { canShare, copyLink, profilePath, shareLink } from "@/lib/share";
import { useApi } from "@/lib/use-api";
import type { PlaylistView } from "@/server/social/sharing";

const KIND = { private: "Playlist", link: "Playlist · shared by link", users: "Shared playlist", public: "Public playlist" } as const;

export default function PlaylistPage() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <PlaylistPageContent />
    </Suspense>
  );
}

function PlaylistPageContent() {
  const { id } = useParams<{ id: string }>();
  const library = useLibrary();
  const prompt = usePrompt();
  const toast = useToast();
  const router = useRouter();
  // From a share link: ?key= lets them in.
  const key = useSearchParams().get("key");
  const { data, error, reload } = useApi<PlaylistView>(`/api/playlists/${id}${key ? `?key=${encodeURIComponent(key)}` : ""}`, library.version);
  const [sharing, setSharing] = useState<Sharing & { base: PlaylistView }>();
  const [sharingOpen, setSharingOpen] = useState(false);
  const [sort, setSort] = useSongSort(`playlist:${id}`, { field: "order", descending: false });
  const find = useFind(`playlist:${id}`, "Find in playlist");

  if (error) return <EmptyState title="Playlist not found" body="It may have been deleted, or its owner stopped sharing it." />;
  if (!data) return <CollectionSkeleton />;
  const share: Sharing = sharing?.base === data ? sharing : { visibility: data.visibility, shareUrl: data.shareUrl, sharedWith: data.sharedWith ?? [] };
  // What to send someone: the link with its key, or (shared or public) the plain link.
  const sendPath = data.owned ? (share.visibility === "link" ? share.shareUrl : share.visibility !== "private" ? `/playlist/${id}` : undefined) : `/playlist/${id}${key ? `?key=${encodeURIComponent(key)}` : ""}`;
  const sorted = sortItems(data.items, (i) => i.song, sort);
  const items = findItems(sorted, (i) => i.song, find.query);
  const songs = items.map((i) => i.song);
  // The cover is the first songs added, however it's sorted.
  const covers = [...new Set(data.items.flatMap((i) => (i.song.artworkUrl ? [i.song.artworkUrl] : [])))].slice(0, 4);

  async function rename() {
    const name = await prompt({ title: "Rename playlist", label: "Name", defaultValue: data!.name });
    if (!name) return;
    await api(`/api/playlists/${id}`, { method: "PATCH", json: { name } });
    await library.refreshPlaylists();
    reload();
  }

  async function remove() {
    if (!window.confirm(`Delete “${data!.name}”? This can't be undone.`)) return;
    await api(`/api/playlists/${id}`, { method: "DELETE" });
    await library.refreshPlaylists();
    toast(`Deleted ${data!.name}`);
    router.push("/");
  }

  const linkItems: MenuItem[] = sendPath
    ? [
        { label: "Copy link", icon: "copy", onSelect: () => void copyLink(sendPath).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link.", ok ? "info" : "error")) },
        ...(canShare() ? [{ label: "Share…", icon: "share" as const, onSelect: () => void shareLink(sendPath, data.name) }] : []),
      ]
    : [];

  return (
    <>
      <CollectionHeader
        kind={KIND[share.visibility]}
        title={data.name}
        description={data.description}
        meta={
          !data.owned && (
            <>
              By <Link href={profilePath(data.owner.username)}>{data.owner.name}</Link>
            </>
          )
        }
        songs={sorted.map((i) => i.song)}
        artwork={covers.length >= 4 ? <Collage covers={covers} /> : undefined}
        actions={
          <>
            {data.owned && <IconButton icon="share" label="Share" onClick={() => setSharingOpen(true)} size={22} />}
            <Menu
              label="Playlist options"
              items={
                data.owned
                  ? [
                      { label: "Share…", icon: "users", onSelect: () => setSharingOpen(true) },
                      ...linkItems,
                      { divider: true, label: "" },
                      { label: "Rename", icon: "edit", onSelect: rename },
                      { label: "Delete playlist", icon: "trash", onSelect: remove },
                    ]
                  : [...linkItems, { label: `Go to ${data.owner.name}`, icon: "user", href: profilePath(data.owner.username) }]
              }
            />
          </>
        }
        trailing={
          sorted.length > 1 && (
            <>
              {find.field(songs.length)}
              <SortMenu sort={sort} onChange={setSort} />
            </>
          )
        }
      />
      {songs.length ? (
        <SongList
          songs={songs}
          numbered
          rowMenu={(_, i) => !data.owned ? [] : [
            {
              label: "Remove from this playlist",
              icon: "trash",
              onSelect: async () => {
                await api(`/api/playlists/${id}/items/${items[i].itemId}`, { method: "DELETE" });
                await library.refreshPlaylists();
                reload();
              },
            },
          ]}
        />
      ) : find.query ? (
        <EmptyState title="No matches" body={`Nothing in this playlist matches “${find.query.trim()}”.`} />
      ) : data.owned ? (
        <EmptyState title="An empty playlist, full of potential" body="Find a song, open its ••• menu and choose Add to playlist." />
      ) : (
        <EmptyState title="Nothing in here yet" body={`${data.owner.name} hasn't added any songs.`} />
      )}
      {sharingOpen && data.owned && (
        <ShareSheet playlist={data} sharing={share} onChange={(s) => setSharing({ ...s, base: data })} onClose={() => setSharingOpen(false)} />
      )}
    </>
  );
}

function Collage({ covers }: { covers: string[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: 208, height: 208 }}>
      {covers.map((c) => (
        <Artwork key={c} src={c} size={104} radius="sm" className="" />
      ))}
    </div>
  );
}
