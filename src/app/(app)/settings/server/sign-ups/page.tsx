"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { copyInvite, InviteList, type Invite } from "../../invites";
import { Card, Group, Row, Segmented, settingsStyles as s } from "../../parts";
import { AdminPage, type Save } from "../admin";

export default function SignUpsPage() {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data: invites } = useApi<Invite[]>("/api/invites", version);

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

  return (
    <AdminPage title="Sign-ups" description="Who can create an account. The first account is always an admin.">
      {(settings, save) => {
        const closed = settings.signups === "closed";
        return (
          <>
            <Group id="access" title="Access">
              <Card>
                <Row
                  wide
                  title="Who can join"
                  note={
                    settings.signups === "invite"
                      ? "Only people with an invite link."
                      : settings.signups === "open"
                        ? "Anyone who can reach this server. Best on a private network."
                        : "No new accounts. Existing invites stop working."
                  }
                >
                  <Segmented
                    label="Who can join"
                    value={settings.signups}
                    onChange={(signups) => save({ signups })}
                    options={[
                      { value: "invite", label: "Invite only" },
                      { value: "open", label: "Anyone" },
                      { value: "closed", label: "No one" },
                    ]}
                  />
                </Row>
                <Row title="Account limit" note="New sign-ups stop at this many accounts. Leave empty for no limit.">
                  <AccountLimit key={settings.maxAccounts} value={settings.maxAccounts} save={save} />
                </Row>
              </Card>
            </Group>

            <Group id="invites" title="Invites">
              <Card>
                <Row wide title="Who can invite" note={closed ? "No one, while sign-ups are closed." : settings.invitesBy === "admins" ? "Only admins can create invite links." : "Anyone with an account can create invite links."}>
                  <Segmented
                    label="Who can invite"
                    value={settings.invitesBy}
                    onChange={(invitesBy) => save({ invitesBy })}
                    options={[
                      { value: "admins", label: "Admins" },
                      { value: "everyone", label: "Everyone" },
                    ]}
                  />
                </Row>
                <Row wide title="Invites expire after" note="Each invite also stops working once it's used.">
                  <Segmented
                    label="Invites expire after"
                    value={settings.inviteDays}
                    onChange={(inviteDays) => save({ inviteDays })}
                    options={[
                      { value: 1, label: "1 day" },
                      { value: 7, label: "1 week" },
                      { value: 30, label: "30 days" },
                      { value: 0, label: "Never" },
                    ]}
                  />
                </Row>
              </Card>
              <Card>
                <Row title="Invite links" note={closed ? "Sign-ups are closed, so new links won't work." : "Every invite on this server, newest first."}>
                  <button type="button" className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`} onClick={create} disabled={closed}>
                    <Icon name="plus" /> Create link
                  </button>
                </Row>
                {invites && invites.length > 0 && <InviteList invites={invites} onRevoke={revoke} />}
              </Card>
            </Group>
          </>
        );
      }}
    </AdminPage>
  );
}

function AccountLimit({ value, save }: { value: number; save: Save }) {
  const [limit, setLimit] = useState(String(value || ""));
  const commit = () => {
    const n = limit.trim() ? Math.floor(Number(limit)) : 0;
    if (!Number.isFinite(n) || n === value) return setLimit(String(value || ""));
    void save({ maxAccounts: n }, n ? `Limit set to ${plural(n, "account")}` : "Account limit removed");
  };
  return (
    <input
      className={s.input}
      style={{ width: 96 }}
      inputMode="numeric"
      placeholder="None"
      value={limit}
      onChange={(e) => setLimit(e.target.value.replace(/\D/g, "").slice(0, 6))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      aria-label="Account limit"
    />
  );
}
