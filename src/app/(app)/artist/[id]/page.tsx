"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { CardLink } from "@/components/song/song-card";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { Artwork, EmptyState, Section, ui } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

interface Artist {
  id: string;
  name: string;
  artworkUrl?: string;
  songs: SongResult[];
  albums: { id: string; title: string; artworkUrl?: string }[];
}

export default function ArtistPage() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <ArtistPageContent />
    </Suspense>
  );
}

function ArtistPageContent() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<Artist>(`/api/artists/${id}`);
  if (error) return <EmptyState title="Artist not found" body="Try searching for them; Harmoni learns about artists as you search." />;
  if (!data) return <CollectionSkeleton />;
  return (
    <>
      <CollectionHeader kind="Artist" title={data.name} songs={data.songs} round artwork={<Artwork src={data.artworkUrl} size={208} radius="xl" />} />
      <Section title="Songs">
        <SongList songs={data.songs.slice(0, 20)} numbered />
      </Section>
      {data.albums.length > 0 && (
        <Section title="Albums and singles">
          <div className={ui.cardGrid}>
            {data.albums.map((a) => (
              <CardLink key={a.id} href={`/album/${a.id}`} artwork={a.artworkUrl} title={a.title} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
