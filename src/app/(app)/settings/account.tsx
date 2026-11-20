"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { Avatar } from "@/components/profile/avatar";
import { usePrompt } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences, useUser } from "@/components/providers/user";
import { ui } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { profilePath } from "@/lib/share";
import { Badge, Card, Group, Row, RowLink, SettingsPage, settingsStyles as s } from "./parts";

export function AccountSettings() {
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const prompt = usePrompt();
  const toast = useToast();
  const router = useRouter();

  async function rename() {
    const name = await prompt({ title: "Change name", note: "Shown to other people on this server.", label: "Name", defaultValue: user?.name, confirm: "Save" });
    if (!name || name === user?.name) return;
    await updatePreferences({ name }).then(
      () => toast("Name changed"),
      () => toast("Couldn't change your name.", "error"),
    );
  }

  async function changePassword() {
    const currentPassword = await prompt({ title: "Change password", label: "Current password", password: true, confirm: "Next" });
    if (!currentPassword) return;
    const newPassword = await prompt({ title: "Change password", note: "At least 8 characters.", label: "New password", password: true, confirm: "Change password" });
    if (!newPassword) return;
    if (newPassword.length < 8) return toast("Use at least 8 characters.", "error");
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: false });
    if (error) toast(/invalid|incorrect/i.test(error.message ?? "") ? "Current password is incorrect." : (error.message ?? "Couldn't change your password."), "error");
    else toast("Password changed");
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <SettingsPage title="Account">
      <Group id="profile" title="Profile">
        <Card>
          <div className={s.row}>
            {user ? <Avatar name={user.name} url={user.avatarUrl} accent={user.accent} size={48} /> : <span className={s.profileAvatar} />}
            <div className={s.rowText}>
              <div className={s.itemTitle}>
                {user?.name ?? " "}
                {user?.role === "admin" && <Badge tone="accent">Admin</Badge>}
              </div>
              <div className={s.rowNote}>{user ? `@${user.username}` : " "}</div>
            </div>
            <div className={s.rowControl}>
              <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={rename} disabled={!user}>
                <Icon name="edit" /> Change name
              </button>
            </div>
          </div>
          {user && <RowLink href={profilePath(user.username)} icon="palette" title="Edit profile" note="Picture, banner, colours and pinned songs" />}
        </Card>
      </Group>

      <Group id="sign-in" title="Sign-in">
        <Card>
          <Row title="Password">
            <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={changePassword}>
              <Icon name="key" /> Change password
            </button>
          </Row>
          <Row title="Sign out" note="Sign out of Harmoni on this device.">
            <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={signOut}>
              <Icon name="logout" /> Sign out
            </button>
          </Row>
        </Card>
      </Group>
    </SettingsPage>
  );
}
