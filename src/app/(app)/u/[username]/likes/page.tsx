"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { EmptyState } from "@/components/ui";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";
import type { ProfileView } from "@/server/social/profile";

// Everything someone has liked, when they show it on their profile.
export default function ProfileLikesRoute() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <ProfileLikes />
    </Suspense>
  );
}

function ProfileLikes() {
  const username = decodeURIComponent(useParams<{ username: string }>().username);
  const { data: profile } = useApi<ProfileView>(`/api/users/${encodeURIComponent(username)}`);
  const { data: songs, error } = useApi<SongResult[]>(`/api/users/${encodeURIComponent(username)}/likes`);
  if (error) return <EmptyState title="Not shown" body="They keep their liked songs to themselves." />;
  if (!songs || !profile) return <CollectionSkeleton />;
  return (
    <>
      <CollectionHeader kind="Liked by" title={profile.user.name} songs={songs} />
      <SongList songs={songs} numbered />
    </>
  );
}
