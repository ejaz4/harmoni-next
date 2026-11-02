"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { renameDevice, useLink } from "@/components/player/link";
import { canFade } from "@/components/player/mixer";
import { useConfirm, usePrompt } from "@/components/providers/prompt";
import { useSettings } from "@/components/providers/settings";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences, useUser } from "@/components/providers/user";
import { ui } from "@/components/ui";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { plural } from "@/lib/format";
import { describeUserAgent } from "@/lib/link";
import { useApi } from "@/lib/use-api";
import styles from "../pages.module.css";
import { ImportLibrary } from "./import";
import { copyInvite, InviteList, type Invite } from "./invites";
import { ago, Badge, Card, Group, Range, Row, RowLink, settingsStyles as s, Switch } from "./parts";

const noSubscribe = () => () => {};
const SESSIONS_SHOWN = 4; // the latest; the rest behind "Show all"

export default function SettingsPage() {
  const user = useUser();
  return (
    <div className={s.page}>
      <h1 className={styles.pageTitle}>Settings</h1>
      <p className={styles.pageSubtitle}>Make Harmoni yours.</p>

      <Account />
      {user?.role === "admin" && (
        <Group title="Your server">
          <Card>
            <RowLink
              href="/settings/server"
              icon="server"
              title="Server settings"
              note={`You run ${user.server.name}: people, sign-ups, features, where music comes from, and the audio cache.`}
            />
          </Card>
        </Group>
      )}
      <Playback />
      <Listening />
      <ImportLibrary />
      {user?.server.features.link !== false && <HarmoniLink />}
      <Sessions />
      {user?.server.canInvite && <Invites />}
      <Developer />
    </div>
  );
}

function Account() {
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const prompt = usePrompt();
  const toast = useToast();
  const router = useRouter();

  async function rename() {
    const name = await prompt({ title: "Your name", note: "It's what Harmoni calls you, and what other people here see.", label: "Name", defaultValue: user?.name, confirm: "Save" });
    if (!name || name === user?.name) return;
    await updatePreferences({ name }).then(
      () => toast("Name changed"),
      () => toast("Couldn't change your name.", "error"),
    );
  }

  async function changePassword() {
    const currentPassword = await prompt({ title: "Change your password", note: "First, the one you use now.", label: "Current password", password: true, confirm: "Next" });
    if (!currentPassword) return;
    const newPassword = await prompt({ title: "Change your password", note: "Now a new one, at least 8 characters.", label: "New password", password: true, confirm: "Change password" });
    if (!newPassword) return;
    if (newPassword.length < 8) return toast("That's too short: at least 8 characters.", "error");
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: false });
    if (error) toast(/invalid|incorrect/i.test(error.message ?? "") ? "That isn't your current password." : (error.message ?? "Couldn't change it."), "error");
    else toast("Password changed");
  }

  return (
    <Group id="account" title="Your account">
      <Card>
        <Row
          title={user?.name ?? " "}
          note={
            <>
              @{user?.username}
              {user?.role === "admin" && " · Admin"}
            </>
          }
        >
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={rename} disabled={!user}>
            <Icon name="edit" /> Edit
          </button>
        </Row>
        <Row title="Password" note="The one you sign in with.">
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={changePassword}>
            <Icon name="key" /> Change
          </button>
        </Row>
        <Row title="Sign out" note="Of this device. Your queue will be here when you're back.">
          <button
            type="button"
            className={`${ui.button} ${ui.buttonSmall}`}
            onClick={async () => {
              await authClient.signOut();
              router.replace("/login");
              router.refresh();
            }}
          >
            <Icon name="logout" /> Sign out
          </button>
        </Row>
      </Card>
    </Group>
  );
}

function Playback() {
  const { settings, update } = useSettings();
  const fades = useSyncExternalStore(noSubscribe, canFade, () => true);
  const wakeLock = useSyncExternalStore(noSubscribe, () => "wakeLock" in navigator, () => true);
  const crossfade = fades ? settings.crossfade : 0;

  return (
    <Group id="playback" title="Playback" note="These are for this device, so your phone and computer can each have their own.">
      <Card>
        <Row
          wide
          title="Crossfade"
          note={
            fades
              ? crossfade
                ? `Each song fades into the next over ${crossfade} seconds.`
                : "Fade each song into the next, the way a DJ would."
              : "This device doesn't let websites fade audio (iPhones and iPads don't), so songs play one after the other."
          }
        >
          <Range value={crossfade} min={0} max={12} onChange={(v) => update({ crossfade: v })} label="Crossfade" format={(v) => (v ? `${v} s` : "Off")} disabled={!fades} />
        </Row>
        <Row title="Smooth play and pause" note={fades ? "Eases the music in and out instead of cutting it." : "Not on this device, for the same reason."}>
          <Switch checked={fades && settings.smoothPause} onChange={(on) => update({ smoothPause: on })} label="Smooth play and pause" disabled={!fades} />
        </Row>
        <Row title="Load the next song early" note="Next songs start straight away, even on a slow connection. Turn it off to use less data.">
          <Switch checked={settings.preloadNext} onChange={(on) => update({ preloadNext: on })} label="Load the next song early" />
        </Row>
        <Row title="Keep the screen on for lyrics" note={wakeLock ? "While the lyrics are showing, the screen won't dim or lock." : "This browser can't keep the screen on."}>
          <Switch checked={wakeLock && settings.keepAwake} onChange={(on) => update({ keepAwake: on })} label="Keep the screen on for lyrics" disabled={!wakeLock} />
        </Row>
      </Card>
    </Group>
  );
}

function Listening() {
  const user = useUser();
  const updatePreferences = useUpdatePreferences();
  const confirm = useConfirm();
  const toast = useToast();
  const features = user?.server.features;
  const on = !!user?.superProcessing;
  const set = (patch: Parameters<typeof updatePreferences>[0], failed: string) => updatePreferences(patch).catch(() => toast(failed, "error"));
  const off = <span className={s.unavailable}>Off on this server</span>;

  async function forget() {
    const sure = await confirm({
      title: "Forget what it's learned?",
      note: "Your listening history for Super Processing goes, and your home screen starts again from scratch. Your likes and playlists stay.",
      confirm: "Forget",
      danger: true,
    });
    if (!sure) return;
    try {
      await api("/api/me/listening", { method: "DELETE" });
      toast("Forgotten. Super Processing starts again from scratch.");
    } catch {
      toast("Couldn't clear that. Try again?", "error");
    }
  }

  return (
    <Group id="super-processing" title="Listening">
      <Card>
        <Row
          title="Super Processing"
          note="Harmoni learns from how you listen, and uses it to fill your home screen with mixes, new finds and old favourites, and to choose what autoplay plays next."
        >
          {features?.superProcessing === false ? off : <Switch checked={on} onChange={(v) => set({ superProcessing: v }, "Couldn't change Super Processing.")} label="Super Processing" />}
        </Row>
        {on && (
          <>
            <ul className={styles.detailList} style={{ margin: "0 20px 16px 38px" }}>
              <li>Which songs you finish, which you skip and how soon, and the parts you go back to hear again</li>
              <li>What you like, what&apos;s in your playlists, and the artists you keep coming back to</li>
              <li>All of it stays on this Harmoni server and is only used for you</li>
            </ul>
            <Row title="Forget what it has learned" note="Start again from scratch.">
              <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={forget}>
                <Icon name="trash" /> Forget
              </button>
            </Row>
          </>
        )}
        <Row title="Autoplay" note={`When your queue runs out, keep playing songs like the one that just played${on ? ", picked for you" : ""}.`}>
          {features?.autoplay === false ? off : <Switch checked={!!user?.autoplay} onChange={(v) => set({ autoplay: v }, "Couldn't change autoplay.")} label="Autoplay" />}
        </Row>
      </Card>
    </Group>
  );
}

function HarmoniLink() {
  const link = useLink();
  const prompt = usePrompt();
  const me = link.devices.find((d) => d.id === link.self);
  const others = link.devices.length - (me ? 1 : 0);

  async function rename() {
    const name = await prompt({
      title: "Name this device",
      note: "It's how this device shows up in Harmoni Link on your others. Leave it empty to go back to the automatic name.",
      label: "Name",
      defaultValue: me?.name,
      confirm: "Save",
    });
    if (name !== undefined) renameDevice(name);
  }

  return (
    <Group
      id="link"
      title={
        <>
          Harmoni <em>Link</em>
        </>
      }
      note={
        <>
          Your queue follows you between devices. Open Harmoni on any of them, then use the <Icon name="link" /> button by the player to play there, or to control
          whichever one is playing.
        </>
      }
    >
      <Card>
        <Row
          title={me ? me.name : "Connecting…"}
          note={me ? `This device${others > 0 ? `. ${plural(others, "other device")} ${others === 1 ? "is" : "are"} here now.` : "."}` : undefined}
        >
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={rename} disabled={!me}>
            <Icon name="edit" /> Rename
          </button>
        </Row>
      </Card>
    </Group>
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
    const sure = await confirm({ title: "Sign out everywhere else?", note: "Every other phone, tablet and browser signed in as you will need your password again.", confirm: "Sign out" });
    if (!sure) return;
    const { error } = await authClient.revokeOtherSessions();
    if (error) toast("Couldn't sign them out.", "error");
    else toast("Signed out everywhere else");
    setVersion((v) => v + 1);
  }

  async function signOut(token: string) {
    const { error } = await authClient.revokeSession({ token });
    if (error) toast("Couldn't sign that one out.", "error");
    setVersion((v) => v + 1);
  }

  const others = sessions?.filter((x) => x.token !== current).length ?? 0;
  return (
    <Group id="sessions" title="Where you're signed in">
      <Card>
        {!sessions ? (
          <p className={s.empty}>Looking…</p>
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
                    <div className={s.itemMeta}>{here ? "Now" : `Last used ${ago(String(x.updatedAt), now)}`}</div>
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
          <Row title="Sign out everywhere else" note={`${plural(others, "other session")}, all signed out at once.`}>
            <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={signOutOthers}>
              <Icon name="power" /> Sign out
            </button>
          </Row>
        )}
      </Card>
    </Group>
  );
}

function Invites() {
  const user = useUser();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data: invites } = useApi<Invite[]>("/api/invites", version);
  const days = user?.server.inviteDays ?? 7;

  async function create() {
    try {
      const invite = await api<{ code: string }>("/api/invites", { method: "POST" });
      setVersion((v) => v + 1);
      await copyInvite(invite.code, toast);
    } catch {
      toast("Couldn't make an invite.", "error");
    }
  }

  async function revoke(code: string) {
    try {
      await api(`/api/invites?code=${encodeURIComponent(code)}`, { method: "DELETE" });
      setVersion((v) => v + 1);
    } catch {
      toast("Couldn't take that invite back.", "error");
    }
  }

  const mine = invites?.filter((i) => !i.createdBy) ?? [];
  return (
    <Group
      id="invites"
      title="Invite someone"
      note={`Each invite works once${days ? ` and lasts ${days === 1 ? "a day" : days === 7 ? "a week" : `${days} days`}` : ""}. Send the link and they can pick their own username and password.`}
    >
      <Card>
        <Row title="New invite link" note="Made and copied in one go.">
          <button type="button" className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`} onClick={create}>
            <Icon name="ticket" /> Create
          </button>
        </Row>
        {mine.length > 0 && <InviteList invites={mine} onRevoke={revoke} />}
      </Card>
    </Group>
  );
}

function Developer() {
  const { settings, update } = useSettings();
  const user = useUser();
  return (
    <Group title="Developer">
      <Card>
        <Row title="Developer mode" note="Shows where each song's audio and lyrics come from, which providers answered a search, and adds a Debug page. Saved on this device.">
          <Switch checked={settings.developerMode} onChange={(on) => update({ developerMode: on })} label="Developer mode" />
        </Row>
      </Card>
      {user && <p className={s.footnote}>Harmoni on {user.server.name}</p>}
    </Group>
  );
}
