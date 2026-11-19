"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { UserList } from "@/components/profile/people";
import { EmptyState, ui } from "@/components/ui";
import { profilePath } from "@/lib/share";
import { useApi } from "@/lib/use-api";
import type { ProfileView, UserCard } from "@/server/social/profile";
import styles from "../../../pages.module.css";

// Someone's followers, or who they follow.
export default function FollowListRoute() {
  return (
    <Suspense>
      <FollowList />
    </Suspense>
  );
}

function FollowList() {
  const { username: raw, list } = useParams<{ username: string; list: string }>();
  const username = decodeURIComponent(raw);
  const which = list === "following" ? "following" : list === "followers" ? "followers" : null;
  const { data: profile } = useApi<ProfileView>(which ? `/api/users/${encodeURIComponent(username)}` : undefined);
  const { data: users, error } = useApi<UserCard[]>(which ? `/api/users/${encodeURIComponent(username)}/${which}` : undefined);

  if (!which || error) return <EmptyState title="Nothing here" body="That page doesn't exist." />;
  const name = profile?.user.name ?? `@${username}`;
  return (
    <>
      <p className={styles.pageEyebrow}>
        <Link href={profilePath(username)}>{name}</Link>
      </p>
      <h1 className={styles.pageTitle}>{which === "followers" ? "Followers" : "Following"}</h1>
      {!users ? (
        <div className={ui.skeleton} style={{ height: 200, borderRadius: 16 }} />
      ) : users.length ? (
        <UserList users={users} />
      ) : (
        <EmptyState
          title={which === "followers" ? "No followers yet" : "Not following anyone yet"}
          body={profile?.isMe ? (which === "followers" ? "Share your profile and people can follow you." : "Search for people you know and follow them.") : ""}
        />
      )}
    </>
  );
}
