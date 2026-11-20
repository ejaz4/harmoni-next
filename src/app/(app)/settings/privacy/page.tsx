"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { plural } from "@/lib/format";
import { describeUserAgent } from "@/lib/link";
import { useApi } from "@/lib/use-api";
import { ago, Badge, Card, Group, Row, SettingsPage, settingsStyles as s } from "../parts";

const SESSIONS_SHOWN = 4; // the latest; the rest behind "Show all"

export default function PrivacyPage() {
  return (
    <SettingsPage title="Privacy & security">
      <Sessions />
      <ConnectedApps />
    </SettingsPage>
  );
}

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function Sessions() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState<SessionRow[]>();
  const [current, setCurrent] = useState<string>();
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(0);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let gone = false;
    void Promise.all([authClient.listSessions(), authClient.getSession()]).then(([list, mine]) => {
      if (gone) return;
      setNow(Date.now());
      const token = mine.data?.session.token;
      // This one first, then the most recently used.
      const used = (x: SessionRow) => (x.token === token ? Infinity : new Date(x.updatedAt).getTime());
      setSessions(((list.data ?? []) as SessionRow[]).sort((a, b) => used(b) - used(a)));
      setCurrent(token);
    });
    return () => {
      gone = true;
    };
  }, [version]);

  async function signOutOthers() {
    const sure = await confirm({ title: "Sign out of all other devices?", note: "They'll need your password to sign in again.", confirm: "Sign out" });
    if (!sure) return;
    const { error } = await authClient.revokeOtherSessions();
    if (error) toast("Couldn't sign them out.", "error");
    else toast("Signed out of all other devices");
    setVersion((v) => v + 1);
  }

  async function signOut(token: string) {
    const { error } = await authClient.revokeSession({ token });
    if (error) toast("Couldn't sign that device out.", "error");
    setVersion((v) => v + 1);
  }

  const others = sessions?.filter((x) => x.token !== current).length ?? 0;
  return (
    <Group id="sessions" title="Signed-in devices">
      <Card>
        {!sessions ? (
          <p className={s.empty}>Loading…</p>
        ) : (
          <ul className={s.list}>
            {(all ? sessions : sessions.slice(0, SESSIONS_SHOWN)).map((x) => {
              const device = describeUserAgent(x.userAgent ?? "");
              const here = x.token === current;
              return (
                <li key={x.id} className={s.item}>
                  <span className={`${s.avatar} ${s.avatarIcon}`}>
                    <Icon name={device.kind === "computer" ? "computer" : "phone"} />
                  </span>
                  <div className={s.itemText}>
                    <div className={s.itemTitle}>
                      {device.name}
                      {here && <Badge tone="accent">This device</Badge>}
                    </div>
                    <div className={s.itemMeta}>{here ? "Active now" : `Last active ${ago(String(x.updatedAt), now)}`}</div>
                  </div>
                  {!here && (
                    <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={() => signOut(x.token)}>
                      Sign out
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!all && sessions && sessions.length > SESSIONS_SHOWN && (
          <button type="button" className={s.more} onClick={() => setAll(true)}>
            Show all {sessions.length}
          </button>
        )}
        {others > 0 && (
          <Row title="Sign out of all other devices" note={plural(others, "other device")}>
            <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={signOutOthers}>
              <Icon name="power" /> Sign out all
            </button>
          </Row>
        )}
      </Card>
    </Group>
  );
}

interface ConnectedApp {
  id: string;
  app: string;
  appUri: string | null;
  device: string | null;
  createdAt: string;
  lastUsedAt: string;
}

// Apps signed in with OAuth (the Android app, others): see docs/api.
function ConnectedApps() {
  const toast = useToast();
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const { data: apps } = useApi<ConnectedApp[]>("/api/me/apps", version);
  const [gone, setGone] = useState<string[]>([]);

  async function disconnect(a: ConnectedApp) {
    const sure = await confirm({ title: `Disconnect ${a.app}?`, note: "It's signed out straight away and will need your permission to reconnect.", confirm: "Disconnect" });
    if (!sure) return;
    setGone((g) => [...g, a.id]);
    try {
      await api(`/api/me/apps/${a.id}`, { method: "DELETE" });
      toast(`${a.app} disconnected`);
    } catch {
      setGone((g) => g.filter((id) => id !== a.id));
      toast("Couldn't disconnect it.", "error");
    }
    setVersion((v) => v + 1);
  }

  const shown = apps?.filter((a) => !gone.includes(a.id));
  return (
    <Group id="apps" title="Connected apps" note="Apps you've allowed to use your account. They can't see your password or change your security settings.">
      <Card>
        {!shown ? <p className={s.empty}>Loading…</p> : !shown.length ? <p className={s.empty}>No connected apps.</p> : <AppList apps={shown} onDisconnect={disconnect} />}
      </Card>
    </Group>
  );
}

// Only once there's something to list, so the clock is read in the browser.
function AppList({ apps, onDisconnect }: { apps: ConnectedApp[]; onDisconnect: (a: ConnectedApp) => void }) {
  const [now] = useState(() => Date.now());
  return (
    <ul className={s.list}>
      {apps.map((a) => (
        <li key={a.id} className={s.item}>
          <span className={`${s.avatar} ${s.avatarIcon}`}>
            <Icon name="link" />
          </span>
          <div className={s.itemText}>
            <div className={s.itemTitle}>{a.app}</div>
            <div className={s.itemMeta}>
              {a.device ? `${a.device} · ` : ""}Last used {ago(a.lastUsedAt, now)}
            </div>
          </div>
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={() => onDisconnect(a)}>
            Disconnect
          </button>
        </li>
      ))}
    </ul>
  );
}
