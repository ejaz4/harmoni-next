"use client";

import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { EmptyState } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

export default function RecentPage() {
  const { data } = useApi<SongResult[]>("/api/plays?limit=100");
  if (!data) return <CollectionSkeleton />;
  return (
    <>
      <CollectionHeader kind="Your library" title="Recently Played" songs={data} />
      {data.length ? (
        <SongList songs={data} numbered />
      ) : (
        <EmptyState title="Your history starts here" body="Songs show up once you've listened for at least 30 seconds." />
      )}
    </>
  );
}
