"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import { settingsStyles as s } from "./parts";

// Invite links, for Settings (your own) and Server settings (everyone's).

export interface Invite {
  code: string;
  createdAt: string;
  expiresAt?: string | null;
  usedAt?: string | null;
  usedBy?: string | null;
  createdBy?: string | null; // someone else's, for admins
}

function inviteLink(code: string) {
  return `${window.location.origin}/signup?invite=${code}`;
}

export async function copyInvite(code: string, toast: ReturnType<typeof useToast>) {
  const link = inviteLink(code);
  try {
    await navigator.clipboard.writeText(link);
    toast("Invite link copied");
  } catch {
    // Clipboard needs HTTPS or localhost; on plain LAN http, show the link instead.
    window.prompt("Copy this invite link", link);
  }
}

export function InviteList({ invites, onRevoke }: { invites: Invite[]; onRevoke: (code: string) => void }) {
  const toast = useToast();
  const [now] = useState(() => Date.now());
  return (
    <ul className={s.list} style={{ borderTop: "1px solid var(--border)" }}>
      {invites.map((i) => {
        const expired = !i.usedAt && !!i.expiresAt && new Date(i.expiresAt).getTime() < now;
        return (
          <li key={i.code} className={s.item}>
            <div className={s.itemText}>
              <div className={`${s.itemTitle} ${s.code}`}>{i.code}</div>
              <div className={s.itemMeta}>
                {i.usedAt ? (i.usedBy ? `Used by @${i.usedBy}` : "Used") : expired ? "Expired" : i.expiresAt ? `Not used yet · lasts until ${new Date(i.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Not used yet"}
                {i.createdBy && ` · from ${i.createdBy}`}
              </div>
            </div>
            {!i.usedAt && !expired && (
              <button type="button" className={ui.iconButton} onClick={() => copyInvite(i.code, toast)} aria-label={`Copy invite link for ${i.code}`} title="Copy link">
                <Icon name="copy" />
              </button>
            )}
            {!i.usedAt && (
              <button type="button" className={ui.iconButton} onClick={() => onRevoke(i.code)} aria-label={`Delete invite ${i.code}`} title={expired ? "Remove" : "Take back"}>
                <Icon name="trash" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

