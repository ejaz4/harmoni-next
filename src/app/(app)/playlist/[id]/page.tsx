"use client";

import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLibrary } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { findItems, useFind } from "@/components/song/find";
import { SongList } from "@/components/song/song-list";
import { SortMenu, sortItems, useSongSort } from "@/components/song/sort";
import { Artwork, EmptyState, Menu } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

interface Playlist {
  id: string;
  name: string;
  description?: string;
  items: { itemId: string; song: SongResult }[];
}

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
  const { data, error, reload } = useApi<Playlist>(`/api/playlists/${id}`, library.version);
  const [sort, setSort] = useSongSort(`playlist:${id}`, { field: "order", descending: false });
  const find = useFind(`playlist:${id}`, "Find in playlist");

  if (error) return <EmptyState title="Playlist not found" body="It may have been deleted, or it belongs to someone else." />;
  if (!data) return <CollectionSkeleton />;
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

  return (
    <>
      <CollectionHeader
        kind="Playlist"
        title={data.name}
        description={data.description}
        songs={sorted.map((i) => i.song)}
        artwork={covers.length >= 4 ? <Collage covers={covers} /> : undefined}
        actions={
          <Menu
            label="Playlist options"
            items={[
              { label: "Rename", icon: "edit", onSelect: rename },
              { label: "Delete playlist", icon: "trash", onSelect: remove },
            ]}
          />
        }
        trailing={
          sorted.length > 1 && (
            <>
              {find.button}
              <SortMenu sort={sort} onChange={setSort} />
            </>
          )
        }
      />
      {find.field(songs.length)}
      {songs.length ? (
        <SongList
          songs={songs}
          numbered
          rowMenu={(_, i) => [
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
      ) : (
        <EmptyState title="An empty playlist, full of potential" body="Find a song, open its ••• menu and choose Add to playlist." />
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
