"use client";

import { Icon } from "@/components/icon";
import { useLibrary } from "@/components/providers/library";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { findItems, useFind } from "@/components/song/find";
import { SongList } from "@/components/song/song-list";
import { SortMenu, sortItems, useSongSort } from "@/components/song/sort";
import { EmptyState } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

export default function LikedPage() {
  const library = useLibrary();
  const { data } = useApi<SongResult[]>("/api/likes", library.version);
  const [sort, setSort] = useSongSort("liked", { field: "order", descending: true });
  const find = useFind("liked", "Find in Liked Songs");
  if (!data) return <CollectionSkeleton />;
  // Liked Songs come newest first; sorting works from oldest first.
  const sorted = sortItems([...data].reverse(), (s) => s, sort);
  const songs = findItems(sorted, (s) => s, find.query);
  return (
    <>
      <CollectionHeader
        kind="Your library"
        title="Liked Songs"
        songs={sorted}
        trailing={
          sorted.length > 1 && (
            <>
              {find.field(songs.length)}
              <SortMenu sort={sort} onChange={setSort} />
            </>
          )
        }
        artwork={
          <div style={{ width: 208, height: 208, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #f2d5c4, #c9a7d8)", color: "#2b1d2e", fontSize: 72 }}>
            <Icon name="heart-solid" />
          </div>
        }
      />
      {songs.length ? (
        <SongList songs={songs} numbered />
      ) : find.query ? (
        <EmptyState title="No matches" body={`None of your liked songs match “${find.query.trim()}”.`} />
      ) : (
        <EmptyState title="Nothing here yet" body="Tap the heart on any song and it'll land here, so the good stuff is always one click away." />
      )}
    </>
  );
}
