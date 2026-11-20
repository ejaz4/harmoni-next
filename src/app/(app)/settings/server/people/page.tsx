"use client";

import { useState } from "react";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { useUser } from "@/components/providers/user";
import { IconButton, Menu, type MenuItem } from "@/components/ui";
import type { AdminUser } from "@/lib/admin";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { ago, Badge, Card, Group, SettingsPage, settingsStyles as s, useNow } from "../../parts";

export default function PeoplePage() {
  return (
    <SettingsPage title="People">
      <People />
    </SettingsPage>
  );
}

function People() {
  const me = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const { data: people } = useApi<AdminUser[]>("/api/admin/users", version);
  const [revealed, setRevealed] = useState<{ id: string; password: string }>();
  const now = useNow();

  async function act(person: AdminUser, request: () => Promise<unknown>, done: string) {
    try {
      await request();
      toast(done);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Couldn't do that.", "error");
    }
    setVersion((v) => v + 1);
  }

  const patch = (p: AdminUser, body: object, done: string) => act(p, () => api(`/api/admin/users/${p.id}`, { method: "PATCH", json: body }), done);

  async function resetPassword(p: AdminUser) {
    const sure = await confirm({
      title: `Reset ${p.name}'s password?`,
      note: "A new password is generated for you to send them. They're signed out everywhere.",
      confirm: "Reset password",
    });
    if (!sure) return;
    try {
      const { password } = await api<{ password: string }>(`/api/admin/users/${p.id}`, { method: "POST", json: { action: "reset-password" } });
      setRevealed({ id: p.id, password });
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : "Couldn't reset it.", "error");
    }
  }

  async function signOut(p: AdminUser) {
    const self = p.id === me?.id;
    const sure = await confirm({
      title: self ? "Sign out of your other devices?" : `Sign ${p.name} out everywhere?`,
      note: self ? "You'll stay signed in here." : "They'll need their password to sign in again.",
      confirm: "Sign out",
    });
    if (sure) await act(p, () => api(`/api/admin/users/${p.id}`, { method: "POST", json: { action: "sign-out" } }), self ? "Signed out of other devices" : `${p.name} signed out`);
  }

  async function suspend(p: AdminUser) {
    if (p.suspended) return patch(p, { suspended: false }, `${p.name} unsuspended`);
    const sure = await confirm({
      title: `Suspend ${p.name}?`,
      note: "They're signed out and can't sign in until you unsuspend them. Their library is kept.",
      confirm: "Suspend",
      danger: true,
    });
    if (sure) await patch(p, { suspended: true }, `${p.name} suspended`);
  }

  async function remove(p: AdminUser) {
    const sure = await confirm({
      title: `Delete ${p.name}'s account?`,
      note: `@${p.username} and all their likes, playlists, Spices and listening history are permanently deleted.`,
      confirm: "Delete account",
      danger: true,
    });
    if (sure) await act(p, () => api(`/api/admin/users/${p.id}`, { method: "DELETE" }), `${p.name}'s account deleted`);
  }

  async function setRole(p: AdminUser) {
    const making = p.role !== "admin";
    const self = p.id === me?.id;
    const sure = await confirm({
      title: making ? `Make ${p.name} an admin?` : self ? "Stop being an admin?" : `Remove ${p.name} as an admin?`,
      note: making ? "Admins can change every server setting, including other admins." : self ? "You'll lose access to server settings." : "They keep their account and library.",
      confirm: making ? "Make admin" : "Remove admin",
      danger: !making,
    });
    if (sure) await patch(p, { role: making ? "admin" : "user" }, making ? `${p.name} is now an admin` : `${p.name} is no longer an admin`);
  }

  return (
    <Group id="people" title={people ? plural(people.length, "account") : "Accounts"}>
      <Card>
        {!people ? (
          <p className={s.empty}>Loading…</p>
        ) : (
          <ul className={s.list}>
            {people.map((p) => {
              const self = p.id === me?.id;
              const items: MenuItem[] = [
                { label: p.role === "admin" ? "Remove as admin" : "Make admin", icon: "shield", onSelect: () => setRole(p) },
                ...(!self ? [{ label: "Reset password", icon: "key" as const, onSelect: () => resetPassword(p) }] : []),
                { label: self ? "Sign out other devices" : "Sign out everywhere", icon: "power", onSelect: () => signOut(p) },
                ...(!self
                  ? [
                      { divider: true, label: "" },
                      { label: p.suspended ? "Unsuspend" : "Suspend", icon: "user-block" as const, onSelect: () => suspend(p) },
                      { label: "Delete account", icon: "trash" as const, danger: true, onSelect: () => remove(p) },
                    ]
                  : []),
              ];
              return (
                <li key={p.id}>
                  <div className={s.item}>
                    <span className={s.avatar} aria-hidden>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className={s.itemText}>
                      <div className={s.itemTitle}>
                        {p.name}
                        {self && <Badge>You</Badge>}
                        {p.role === "admin" && <Badge tone="accent">Admin</Badge>}
                        {p.suspended && <Badge tone="danger">Suspended</Badge>}
                      </div>
                      <div className={s.itemMeta}>
                        @{p.username} · joined {ago(p.createdAt, now)}
                        {p.invitedBy && ` · invited by ${p.invitedBy}`} · {self ? "active now" : `active ${ago(p.lastSeenAt, now)}`} · {plural(p.plays, "play")}
                      </div>
                    </div>
                    <Menu label={`Manage ${p.name}`} items={items} header={<p className={s.rowTitle}>{p.name}</p>} />
                  </div>
                  {revealed?.id === p.id && (
                    <div className={s.secret} role="status">
                      <span className={s.code}>{revealed.password}</span>
                      <IconButton
                        icon="copy"
                        label="Copy password"
                        onClick={() =>
                          navigator.clipboard?.writeText(revealed.password).then(
                            () => toast("Password copied"),
                            () => {},
                          )
                        }
                      />
                      <IconButton icon="close" label="Hide" onClick={() => setRevealed(undefined)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {revealed && <p className={s.footnote}>Send this to them now. It won&apos;t be shown again.</p>}
    </Group>
  );
}
