"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { useSettings } from "@/components/providers/settings";
import { useToast } from "@/components/providers/toast";
import { useUser } from "@/components/providers/user";
import { ui } from "@/components/ui";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useApi } from "@/lib/use-api";
import styles from "../pages.module.css";

interface Invite {
  code: string;
  createdAt: string;
  expiresAt?: string;
  usedAt?: string;
  usedBy?: string;
}

export default function SettingsPage() {
  const user = useUser();
  const { settings, update } = useSettings();
  const router = useRouter();

  return (
    <>
      <h1 className={styles.pageTitle}>Settings</h1>
      <p className={styles.pageSubtitle}>Make Harmoni yours.</p>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Your account</h2>
        <p className={styles.panelText}>
          Signed in as <strong>{user?.name}</strong> (@{user?.username}){user?.role === "admin" && ", and you run this Harmoni"}.
        </p>
        <button
          type="button"
          className={ui.button}
          onClick={async () => {
            await authClient.signOut();
            router.replace("/login");
            router.refresh();
          }}
        >
          <Icon name="logout" /> Sign out
        </button>
      </section>

      {user?.role === "admin" && <Invites />}

      <section className={styles.panel}>
        <div className={styles.toggleRow}>
          <div>
            <h2 className={styles.panelTitle}>Developer mode</h2>
            <p className={styles.panelText} style={{ marginBottom: 0 }}>
              Shows where each song&apos;s audio and lyrics come from, which providers answered a search, and adds a Debug page. Saved on this device.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.developerMode}
            aria-label="Developer mode"
            className={styles.switch}
            onClick={() => update({ developerMode: !settings.developerMode })}
          />
        </div>
      </section>
    </>
  );
}

function Invites() {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data: invites } = useApi<Invite[]>("/api/invites", version);

  async function create() {
    try {
      const invite = await api<{ code: string }>("/api/invites", { method: "POST" });
      setVersion((v) => v + 1);
      await copy(invite.code);
    } catch {
      toast("Couldn't make an invite.", "error");
    }
  }

  async function copy(code: string) {
    const link = `${window.location.origin}/signup?invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied");
    } catch {
      // Clipboard needs HTTPS or localhost; on plain LAN http, show the link instead.
      window.prompt("Copy this invite link", link);
    }
  }

  return (
    <section className={styles.panel} id="invites">
      <h2 className={styles.panelTitle}>Invite someone</h2>
      <p className={styles.panelText}>Each invite works once and lasts a week. Send the link and they can pick their own username and password.</p>
      <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={create}>
        <Icon name="ticket" /> Create invite link
      </button>
      {invites && invites.length > 0 && (
        <ul className={styles.invites}>
          {invites.map((i) => {
            const expired = !i.usedAt && i.expiresAt && new Date(i.expiresAt) < new Date();
            return (
              <li key={i.code} className={styles.invite}>
                <span className={styles.inviteCode}>{i.code}</span>
                <span className={styles.inviteStatus}>{i.usedAt ? `Used by ${i.usedBy ?? "someone"}` : expired ? "Expired" : "Not used yet"}</span>
                {!i.usedAt && !expired && (
                  <button type="button" className={ui.iconButton} onClick={() => copy(i.code)} aria-label={`Copy invite link for ${i.code}`} title="Copy link">
                    <Icon name="copy" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
