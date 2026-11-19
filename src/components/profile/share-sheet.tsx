"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { useToast } from "@/components/providers/toast";
import { useUser } from "@/components/providers/user";
import { ui } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { absolute, copyLink } from "@/lib/share";
import { useApi } from "@/lib/use-api";
import type { UserCard } from "@/server/social/profile";
import type { Visibility } from "@/server/social/sharing";
import { Avatar } from "./avatar";
import styles from "./share-sheet.module.css";

const OPTIONS: { key: Visibility; icon: IconName; title: string; note: string }[] = [
  { key: "private", icon: "lock", title: "Private", note: "Only you" },
  { key: "users", icon: "users", title: "Shared with people", note: "Only the people you pick" },
  { key: "link", icon: "link", title: "Anyone with the link", note: "Anyone here who has the link" },
  { key: "public", icon: "globe", title: "Public", note: "Everyone here, and it's on your profile" },
];

export interface Sharing {
  visibility: Visibility;
  shareUrl?: string;
  sharedWith: UserCard[];
}

// Who can open a playlist. Each change saves as it's made.
export function ShareSheet({ playlist, sharing, onChange, onClose }: { playlist: { id: string; name: string }; sharing: Sharing; onChange: (s: Sharing) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function patch(json: { visibility?: Visibility; resetLink?: boolean }) {
    const before = sharing;
    if (json.visibility) onChange({ ...sharing, visibility: json.visibility });
    setBusy(true);
    try {
      const res = await api<{ visibility: Visibility; shareUrl?: string }>(`/api/playlists/${playlist.id}`, { method: "PATCH", json });
      onChange({ ...sharing, visibility: res.visibility, shareUrl: res.shareUrl });
      if (json.resetLink) toast("New link made. The old one no longer works.");
    } catch (err) {
      onChange(before);
      toast(err instanceof ApiError ? err.message : "Couldn't change who can see it.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function setPeople(people: UserCard[]) {
    const before = sharing;
    onChange({ ...sharing, sharedWith: people });
    try {
      const saved = await api<UserCard[]>(`/api/playlists/${playlist.id}/shares`, { method: "PUT", json: { usernames: people.map((p) => p.username) } });
      onChange({ ...sharing, sharedWith: saved });
    } catch {
      onChange(before);
      toast("Couldn't change who it's shared with.", "error");
    }
  }

  const link = sharing.visibility === "link" ? sharing.shareUrl : sharing.visibility === "public" || sharing.visibility === "users" ? `/playlist/${playlist.id}` : undefined;

  return (
    <dialog ref={dialog} className={styles.sheet} onClose={onClose} onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
      <div className={styles.body}>
        <div className={styles.head}>
          <h2 className={styles.title}>Share “{playlist.name}”</h2>
          <button type="button" className={styles.close} onClick={() => dialog.current?.close()} aria-label="Done">
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.options} role="radiogroup" aria-label="Who can open it">
          {OPTIONS.map((o) => (
            <button key={o.key} type="button" role="radio" aria-checked={sharing.visibility === o.key} className={styles.option} disabled={busy} onClick={() => sharing.visibility !== o.key && patch({ visibility: o.key })}>
              <span className={styles.optionIcon}>
                <Icon name={o.icon} />
              </span>
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>{o.title}</span>
                <span className={styles.optionNote}>{o.note}</span>
              </span>
              <span className={styles.radio} />
            </button>
          ))}
        </div>

        {sharing.visibility === "users" && <PeoplePicker people={sharing.sharedWith} onChange={setPeople} />}

        {link && (
          <div className={styles.linkRow}>
            <input className={styles.linkField} readOnly value={absolute(link)} onFocus={(e) => e.target.select()} aria-label="Link" />
            <button
              type="button"
              className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`}
              onClick={() => void copyLink(link).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link.", ok ? "info" : "error"))}
            >
              <Icon name="copy" /> Copy
            </button>
          </div>
        )}
        {sharing.visibility === "link" && (
          <button type="button" className={styles.reset} onClick={() => patch({ resetLink: true })} disabled={busy}>
            <Icon name="refresh" /> Make a new link (the old one stops working)
          </button>
        )}
        {sharing.visibility === "users" && sharing.sharedWith.length > 0 && <p className={styles.hint}>They&apos;ll find it in their library, under Shared with you.</p>}
      </div>
    </dialog>
  );
}

// Search for people to share with; people you follow are suggested first.
function PeoplePicker({ people, onChange }: { people: UserCard[]; onChange: (p: UserCard[]) => void }) {
  const me = useUser();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const { data: found } = useApi<UserCard[]>(q ? `/api/users?q=${encodeURIComponent(q)}` : undefined);
  const { data: following } = useApi<UserCard[]>(me ? `/api/users/${encodeURIComponent(me.username)}/following` : undefined);
  const chosen = new Set(people.map((p) => p.id));
  const options = (q ? found : following)?.filter((u) => u.id !== me?.id && !chosen.has(u.id)).slice(0, 6) ?? [];

  return (
    <div className={styles.picker}>
      {people.length > 0 && (
        <ul className={styles.chips}>
          {people.map((p) => (
            <li key={p.id} className={styles.chip}>
              <Avatar name={p.name} url={p.avatarUrl} accent={p.accent} size={24} />
              {p.name}
              <button type="button" aria-label={`Stop sharing with ${p.name}`} onClick={() => onChange(people.filter((x) => x.id !== p.id))}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.search}>
        <Icon name="search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Add people by name or username" aria-label="Add people" />
      </div>
      {options.length > 0 && (
        <>
          {!q && <p className={styles.suggested}>People you follow</p>}
          <ul className={styles.results}>
            {options.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className={styles.result}
                  onClick={() => {
                    onChange([...people, u]);
                    setQuery("");
                  }}
                >
                  <Avatar name={u.name} url={u.avatarUrl} accent={u.accent} size={32} />
                  <span className={styles.resultText}>
                    <span>{u.name}</span>
                    <span className={styles.resultHandle}>@{u.username}</span>
                  </span>
                  <Icon name="plus" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {q && found && !options.length && <p className={styles.suggested}>Nobody here matches “{q}”.</p>}
    </div>
  );
}
