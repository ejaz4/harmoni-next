"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { Artwork, EmptyState } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { AlbumPage as AlbumData } from "@/server/library/catalogue";
import styles from "../../artist.module.css";

const KIND_LABELS: Record<string, string> = { album: "Album", ep: "EP", single: "Single", compilation: "Compilation" };

export default function AlbumPage() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <AlbumPageContent />
    </Suspense>
  );
}

function AlbumPageContent() {
  const { id } = useParams<{ id: string }>();
  // The first visit fetches the full tracklist from a provider.
  const { data, error } = useApi<AlbumData>(`/api/albums/${id}`);
  if (error) return <EmptyState title="Album not found" body="Harmoni only knows albums for artists and songs it has seen." />;
  if (!data) return <CollectionSkeleton />;
  return (
    <>
      <CollectionHeader
        kind={KIND_LABELS[data.kind ?? ""] ?? "Album"}
        title={data.title}
        songs={data.songs}
        artwork={<Artwork src={data.artworkUrl} size={208} radius="lg" />}
        meta={
          <>
            {data.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ", "}
                <Link href={`/artist/${a.id}`}>{a.name}</Link>
              </span>
            ))}
            {data.releaseDate && ` · ${data.releaseDate.slice(0, 4)}`}
          </>
        }
      />
      <SongList songs={data.songs} numbered showAlbum={false} />
      {(data.releaseDate || data.label || data.genres.length > 0) && (
        <p className={styles.quiet} style={{ marginTop: 24, lineHeight: 1.7 }}>
          {data.releaseDate &&
            new Date(`${data.releaseDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          {data.label && (
            <>
              <br />℗ {data.label}
            </>
          )}
          {data.genres.length > 0 && (
            <>
              <br />
              {data.genres.join(", ")}
            </>
          )}
        </p>
      )}
    </>
  );
}
