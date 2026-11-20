"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/providers/toast";
import { useUser } from "@/components/providers/user";
import { EmptyState, ui } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { copyInvite, InviteList, type Invite } from "../invites";
import { Card, Group, Row, SettingsPage } from "../parts";

const lasts = (days: number) => (days === 1 ? "a day" : days === 7 ? "a week" : `${days} days`);

export default function InvitesPage() {
  const user = useUser();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const allowed = !!user?.server.canInvite;
  const { data: invites } = useApi<Invite[]>(allowed ? "/api/invites" : undefined, version);
  const days = user?.server.inviteDays ?? 7;

  async function create() {
    try {
      const invite = await api<{ code: string }>("/api/invites", { method: "POST" });
      setVersion((v) => v + 1);
      await copyInvite(invite.code, toast);
    } catch {
      toast("Couldn't create an invite.", "error");
    }
  }

  async function revoke(code: string) {
    try {
      await api(`/api/invites?code=${encodeURIComponent(code)}`, { method: "DELETE" });
      setVersion((v) => v + 1);
    } catch {
      toast("Couldn't delete that invite.", "error");
    }
  }

  if (user && !allowed) {
    return (
      <SettingsPage title="Invite people">
        <EmptyState icon="ticket" title="Invites are off" body="Only admins can invite people to this server." />
      </SettingsPage>
    );
  }

  const mine = invites?.filter((i) => !i.createdBy) ?? [];
  return (
    <SettingsPage title="Invite people" description={`Invite links work once${days ? ` and expire after ${lasts(days)}` : ""}. The person picks their own username and password.`}>
      <Group id="invites">
        <Card>
          <Row title="New invite link" note="Created and copied to your clipboard.">
            <button type="button" className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`} onClick={create}>
              <Icon name="plus" /> Create link
            </button>
          </Row>
          {mine.length > 0 && <InviteList invites={mine} onRevoke={revoke} />}
        </Card>
      </Group>
    </SettingsPage>
  );
}
