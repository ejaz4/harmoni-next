"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import { api } from "@/lib/api";
import { profilePath } from "@/lib/share";
import type { UserCard } from "@/server/social/profile";
import { Avatar } from "./avatar";
import styles from "./profile.module.css";

// Follow, Follow back, or Following (which unfollows). Changes straight
// away and goes back if saving fails.
export function FollowButton({ user, onChange, small }: { user: UserCard; onChange?: (u: UserCard) => void; small?: boolean }) {
  const toast = useToast();
  const [following, setFollowing] = useState(!!user.youFollow);
  const [busy, setBusy] = useState(false);
  // A new person (another row, another page) starts from what they say.
  const [lastId, setLastId] = useState(user.id);
  if (lastId !== user.id) {
    setLastId(user.id);
    setFollowing(!!user.youFollow);
  }
  if (user.youFollow === undefined) return null; // themselves

  async function toggle() {
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const updated = await api<UserCard>(`/api/users/${encodeURIComponent(user.username)}/follow`, { method: next ? "PUT" : "DELETE" });
      onChange?.(updated);
    } catch {
      setFollowing(!next);
      toast(next ? `Couldn't follow ${user.name}.` : `Couldn't unfollow ${user.name}.`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`${ui.button} ${small ? ui.buttonSmall : ""} ${following ? styles.following : styles.follow}`}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      {following ? (
        <>
          <Icon name="check" /> <span className={styles.followingLabel}>Following</span>
        </>
      ) : (
        <>
          <Icon name="user-plus" /> {user.followsYou ? "Follow back" : "Follow"}
        </>
      )}
    </button>
  );
}

export function FollowsYou({ user }: { user: UserCard }) {
  return user.followsYou ? <span className={styles.followsYou}>Follows you</span> : null;
}

// A person in a list: search results, followers, who a playlist is shared with.
export function UserRow({ user, action }: { user: UserCard; action?: React.ReactNode }) {
  return (
    <li className={styles.userRow}>
      <Link href={profilePath(user.username)} className={styles.userRowLink}>
        <Avatar name={user.name} url={user.avatarUrl} accent={user.accent} size={48} />
        <span className={styles.userRowText}>
          <span className={styles.userRowName}>{user.name}</span>
          <span className={styles.userRowHandle}>
            @{user.username}
            <FollowsYou user={user} />
          </span>
        </span>
      </Link>
      {action ?? <FollowButton user={user} small />}
    </li>
  );
}

export function UserList({ users, action }: { users: UserCard[]; action?: (u: UserCard) => React.ReactNode }) {
  return (
    <ul className={styles.userList}>
      {users.map((u) => (
        <UserRow key={u.id} user={u} action={action?.(u)} />
      ))}
    </ul>
  );
}

// People as round cards in a row, for search.
export function PeopleRow({ users }: { users: UserCard[] }) {
  return (
    <div className={styles.peopleRow}>
      {users.map((u) => (
        <Link key={u.id} href={profilePath(u.username)} className={styles.personChip}>
          <Avatar name={u.name} url={u.avatarUrl} accent={u.accent} className={styles.personPhoto} />
          <span className={styles.personName}>{u.name}</span>
          <span className={styles.personHandle}>@{u.username}</span>
        </Link>
      ))}
    </div>
  );
}
