"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useLibrary } from "@/components/providers/library";
import { useToast } from "@/components/providers/toast";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { SongMenu } from "@/components/song/song-menu";
import { EmptyState, IconButton, Section, ui } from "@/components/ui";
import { canShare, copyLink, shareLink, songPath } from "@/lib/share";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";

// Where a copied song link lands: the song, ready to play.
export default function SongPage() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <SongContent />
    </Suspense>
  );
}

function SongContent() {
  const { id } = useParams<{ id: string }>();
  const library = useLibrary();
  const toast = useToast();
  const { data: song, error } = useApi<SongResult>(`/api/songs/${id}`);

  if (error) return <EmptyState title="Song not found" body="The link may be broken, or the song was merged into another one." />;
  if (!song) return <CollectionSkeleton />;
  const artists = song.artists.filter((a) => a.role !== "featured");
  const liked = library.isLiked(song.id);

  return (
    <>
      <CollectionHeader
        kind="Song"
        title={song.title}
        description={artists.map((a) => a.name).join(", ") || undefined}
        meta={song.album?.title}
        songs={[song]}
        actions={
          <>
            <IconButton icon={liked ? "heart-solid" : "heart"} label={liked ? "Remove from Liked" : "Add to Liked"} pressed={liked} onClick={() => library.toggleLike(song)} size={22} />
            <IconButton
              icon={canShare() ? "share" : "copy"}
              label={canShare() ? "Share" : "Copy link"}
              onClick={() =>
                canShare() ? void shareLink(songPath(song.id), song.title) : void copyLink(songPath(song.id)).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link.", ok ? "info" : "error"))
              }
              size={22}
            />
            <SongMenu song={song} />
          </>
        }
      />
      <SongList songs={[song]} single />
      <Section title="More">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {song.album?.id && (
            <Link href={`/album/${song.album.id}`} className={`${ui.button} ${ui.buttonSmall}`}>
              From {song.album.title}
            </Link>
          )}
          {artists.flatMap((a) =>
            a.id
              ? [
                  <Link key={a.id} href={`/artist/${a.id}`} className={`${ui.button} ${ui.buttonSmall}`}>
                    More by {a.name}
                  </Link>,
                ]
              : [],
          )}
        </div>
      </Section>
    </>
  );
}
