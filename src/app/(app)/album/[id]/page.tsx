"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { Artwork, EmptyState } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

interface Album {
  id: string;
  title: string;
  artworkUrl?: string;
  artists: { id: string; name: string }[];
  songs: SongResult[];
}

export default function AlbumPage() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <AlbumPageContent />
    </Suspense>
  );
}

function AlbumPageContent() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<Album>(`/api/albums/${id}`);
  if (error) return <EmptyState title="Album not found" body="Harmoni only knows albums for songs it has seen in a search." />;
  if (!data) return <CollectionSkeleton />;
  return (
    <>
      <CollectionHeader
        kind="Album"
        title={data.title}
        songs={data.songs}
        artwork={<Artwork src={data.artworkUrl} size={208} radius="lg" />}
        meta={data.artists.map((a, i) => (
          <span key={a.id}>
            {i > 0 && ", "}
            <Link href={`/artist/${a.id}`}>{a.name}</Link>
          </span>
        ))}
      />
      <SongList songs={data.songs} numbered showAlbum={false} />
    </>
  );
}
