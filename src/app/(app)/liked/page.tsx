"use client";

import { Icon } from "@/components/icon";
import { useLibrary } from "@/components/providers/library";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { SortMenu, sortItems, useSongSort } from "@/components/song/sort";
import { EmptyState } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

export default function LikedPage() {
  const library = useLibrary();
  const { data } = useApi<SongResult[]>("/api/likes", library.version);
  const [sort, setSort] = useSongSort("liked", { field: "order", descending: true });
  if (!data) return <CollectionSkeleton />;
  // Liked Songs come newest first; sorting works from oldest first.
  const songs = sortItems([...data].reverse(), (s) => s, sort);
  return (
    <>
      <CollectionHeader
        kind="Your library"
        title="Liked Songs"
        songs={songs}
        trailing={songs.length > 1 && <SortMenu sort={sort} onChange={setSort} />}
        artwork={
          <div style={{ width: 208, height: 208, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #f2d5c4, #c9a7d8)", color: "#2b1d2e", fontSize: 72 }}>
            <Icon name="heart-solid" />
          </div>
        }
      />
      {data.length ? (
        <SongList songs={songs} numbered />
      ) : (
        <EmptyState title="Nothing here yet" body="Tap the heart on any song and it'll land here, so the good stuff is always one click away." />
      )}
    </>
  );
}
