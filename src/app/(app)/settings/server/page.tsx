"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Icon } from "@/components/icon";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { useRefreshUser, useUser } from "@/components/providers/user";
import { EmptyState, IconButton, Menu, ui, type MenuItem } from "@/components/ui";
import type { AdminSettings, AdminStats, AdminUser, ProviderRoleName } from "@/lib/admin";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import styles from "../../pages.module.css";
import { copyInvite, InviteList, type Invite } from "../invites";
import { ago, Badge, bytes, Card, Group, Row, Segmented, settingsStyles as s, Switch } from "../parts";

// Settings → Server: how this Harmoni is run. Admins only (the API checks too).

type Patch = Partial<Omit<AdminSettings, "keys" | "providers" | "needKeys" | "features">> & {
  features?: Partial<AdminSettings["features"]>;
  keys?: Record<string, string>;
};

const SECTIONS = [
  ["overview", "Overview"],
  ["general", "General"],
  ["joining", "Joining"],
  ["people", "People"],
  ["features", "Features"],
  ["audio", "Audio"],
  ["providers", "Providers"],
] as const;

export default function ServerSettingsPage() {
  const user = useUser();
  const toast = useToast();
  const refreshUser = useRefreshUser();
  const { data: loaded, error } = useApi<AdminSettings>(user?.role === "admin" ? "/api/admin/settings" : undefined);
  const [settings, setSettings] = useState<AdminSettings>();
  const current = settings ?? loaded;

  // Shows the change at once; puts it back if the server says no.
  const save = useCallback(
    async (patch: Patch, done?: string) => {
      const before = current;
      if (before) setSettings({ ...before, ...patch, features: { ...before.features, ...patch.features }, keys: before.keys } as AdminSettings);
      try {
        setSettings(await api<AdminSettings>("/api/admin/settings", { method: "PATCH", json: patch }));
        if (done) toast(done);
        if (patch.name !== undefined || patch.features || patch.signups || patch.invitesBy || patch.inviteDays !== undefined) refreshUser();
      } catch {
        setSettings(before);
        toast("Couldn't save that. Try again?", "error");
      }
    },
    [current, toast, refreshUser],
  );

  if (user && user.role !== "admin") {
    return <EmptyState title="Admins only" body="Server settings are for the people who run this Harmoni." />;
  }

  return (
    <div className={s.page}>
      <Link href="/settings" className={`${ui.button} ${ui.buttonSmall}`} style={{ marginBottom: 16 }}>
        <Icon name="arrow-left" /> Settings
      </Link>
      <h1 className={styles.pageTitle}>Server settings</h1>
      <p className={styles.pageSubtitle}>{current ? `How ${current.name} is run.` : "How this Harmoni is run."}</p>
      <nav className={s.jump} aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <Overview />
      {error && !current && <p className={s.empty}>Couldn&apos;t load the server&apos;s settings.</p>}
      {current && (
        <>
          <General settings={current} save={save} />
          <Joining settings={current} save={save} />
          <People />
          <Features settings={current} save={save} />
          <Audio settings={current} save={save} />
          <Providers settings={current} save={save} />
        </>
      )}
    </div>
  );
}

type SectionProps = { settings: AdminSettings; save: (patch: Patch, done?: string) => Promise<void> };

// --- Overview ---

function Overview() {
  const { data: stats } = useApi<AdminStats>("/api/admin/stats");
  const hours = (ms: number) => (ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000).toLocaleString()} hours`);
  const uptime = (sec: number) => (sec < 3600 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 86_400 ? `${Math.round(sec / 3600)} hours` : `${Math.round(sec / 86_400)} days`);

  const tiles: [string, string][] = stats
    ? [
        [stats.people.toLocaleString(), `${stats.people === 1 ? "person" : "people"} · ${plural(stats.admins, "admin")}`],
        [stats.online ? stats.online.people.toLocaleString() : "–", stats.online ? `listening now, on ${plural(stats.online.devices, "device")}` : "online now (Link is offline)"],
        [stats.playsThisWeek.toLocaleString(), `plays this week · ${hours(stats.listeningThisWeekMs)}`],
        [stats.songs.toLocaleString(), `songs · ${stats.artists.toLocaleString()} artists`],
        [(stats.playlists + stats.spices).toLocaleString(), `playlists and Spices`],
        [bytes(stats.cache.bytes), `audio cached · ${plural(stats.cache.songs, "song")}`],
        [uptime(stats.uptimeS), `up · Harmoni ${stats.version}`],
        [stats.plays.toLocaleString(), "plays, ever"],
      ]
    : [];

  return (
    <Group id="overview" title="Overview">
      <div className={s.stats}>
        {stats
          ? tiles.map(([value, label]) => (
              <div key={label} className={s.stat}>
                <div className={`${s.statValue} tabular`}>{value}</div>
                <div className={s.statLabel}>{label}</div>
              </div>
            ))
          : Array.from({ length: 8 }, (_, i) => <div key={i} className={`${s.stat} ${s.statSkeleton}`} />)}
      </div>
    </Group>
  );
}

// --- General ---

function TextSetting({ label, note, value, max, multiline, onSave }: { label: string; note: string; value: string; max: number; multiline?: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value); // the parent remounts it when `value` changes
  const dirty = draft.trim() !== value;
  const Field = multiline ? "textarea" : "input";
  return (
    <form
      className={s.field}
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave(draft.trim());
      }}
    >
      <label className={s.fieldLabel} htmlFor={`field-${label}`}>
        {label}
      </label>
      <Field id={`field-${label}`} className={s.input} value={draft} maxLength={max} onChange={(e) => setDraft(e.target.value)} />
      <div className={s.fieldFoot}>
        <span>{note}</span>
        {dirty && <button className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`}>Save</button>}
      </div>
    </form>
  );
}

function General({ settings, save }: SectionProps) {
  return (
    <Group id="general" title="General">
      <Card>
        <TextSetting key={settings.name} label="Server name" note="On the sign-in page and around the app." value={settings.name} max={40} onSave={(name) => save({ name }, "Name saved")} />
        <TextSetting
          key={settings.welcome}
          label="Sign-in message"
          note="A line for people on the sign-in page. Leave it empty for none."
          value={settings.welcome}
          max={200}
          multiline
          onSave={(welcome) => save({ welcome }, "Message saved")}
        />
      </Card>
    </Group>
  );
}

// --- Joining ---

function Joining({ settings, save }: SectionProps) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const { data: invites } = useApi<Invite[]>("/api/invites", version);

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

  const closed = settings.signups === "closed";
  return (
    <Group id="joining" title="Joining" note="Who can make an account here. Whatever you pick, the first account is always the admin.">
      <Card>
        <Row
          wide
          title="Who can join"
          note={
            settings.signups === "invite"
              ? "People with an invite link."
              : settings.signups === "open"
                ? "Anyone who finds the sign-up page. Best on a private network."
                : "No one new. Invites stop working too."
          }
        >
          <Segmented
            label="Who can join"
            value={settings.signups}
            onChange={(signups) => save({ signups })}
            options={[
              { value: "invite", label: "With an invite" },
              { value: "open", label: "Anyone" },
              { value: "closed", label: "No one" },
            ]}
          />
        </Row>
        <Row wide title="Who can invite" note={closed ? "No one, while joining is closed." : settings.invitesBy === "admins" ? "Only admins make invite links." : "Anyone with an account can invite someone."}>
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
        <Row wide title="Invites last" note="Until then, or until someone uses it.">
          <Segmented
            label="Invites last"
            value={settings.inviteDays}
            onChange={(inviteDays) => save({ inviteDays })}
            options={[
              { value: 1, label: "A day" },
              { value: 7, label: "A week" },
              { value: 30, label: "30 days" },
              { value: 0, label: "Forever" },
            ]}
          />
        </Row>
        <Row title="Account limit" note="No one new can join once there are this many. Empty for no limit.">
          <AccountLimit key={settings.maxAccounts} value={settings.maxAccounts} save={save} />
        </Row>
      </Card>
      <Card>
        <Row title="Invite links" note={closed ? "Joining is closed, so new invites won't work." : "Everyone's invites, newest first."}>
          <button type="button" className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`} onClick={create} disabled={closed}>
            <Icon name="ticket" /> Create
          </button>
        </Row>
        {invites && invites.length > 0 && <InviteList invites={invites} onRevoke={revoke} />}
      </Card>
    </Group>
  );
}

function AccountLimit({ value, save }: { value: number; save: SectionProps["save"] }) {
  const [limit, setLimit] = useState(String(value || ""));
  const commit = () => {
    const n = limit.trim() ? Math.floor(Number(limit)) : 0;
    if (!Number.isFinite(n) || n === value) return setLimit(String(value || ""));
    void save({ maxAccounts: n }, n ? `Up to ${plural(n, "account")}` : "No account limit");
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

// --- People ---

function People() {
  const me = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const { data: people } = useApi<AdminUser[]>("/api/admin/users", version);
  const [revealed, setRevealed] = useState<{ id: string; password: string }>();
  const [now] = useState(() => Date.now());

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
      title: `New password for ${p.name}?`,
      note: "Harmoni makes one up for you to send them. Their old password stops working, and they're signed out everywhere.",
      confirm: "Make a new password",
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
      title: self ? "Sign out your other devices?" : `Sign ${p.name} out everywhere?`,
      note: self ? "Everywhere but here." : "They'll need their password to come back.",
      confirm: "Sign out",
    });
    if (sure) await act(p, () => api(`/api/admin/users/${p.id}`, { method: "POST", json: { action: "sign-out" } }), self ? "Signed out everywhere else" : `${p.name} is signed out`);
  }

  async function suspend(p: AdminUser) {
    if (p.suspended) return patch(p, { suspended: false }, `${p.name} can sign in again`);
    const sure = await confirm({
      title: `Suspend ${p.name}?`,
      note: "They're signed out now and can't sign back in until you undo it. Their library stays as it is.",
      confirm: "Suspend",
      danger: true,
    });
    if (sure) await patch(p, { suspended: true }, `${p.name} is suspended`);
  }

  async function remove(p: AdminUser) {
    const sure = await confirm({
      title: `Remove ${p.name}'s account?`,
      note: `@${p.username}, their likes, playlists, Spices and listening history all go, for good.`,
      confirm: "Remove account",
      danger: true,
    });
    if (sure) await act(p, () => api(`/api/admin/users/${p.id}`, { method: "DELETE" }), `${p.name}'s account is gone`);
  }

  async function setRole(p: AdminUser) {
    const making = p.role !== "admin";
    const self = p.id === me?.id;
    const sure = await confirm({
      title: making ? `Make ${p.name} an admin?` : self ? "Stop being an admin?" : `Remove ${p.name} as an admin?`,
      note: making ? "Admins can change everything on this page, including other admins." : self ? "You won't be able to come back to this page." : "They keep their account and library.",
      confirm: making ? "Make admin" : "Remove admin",
      danger: !making,
    });
    if (sure) await patch(p, { role: making ? "admin" : "user" }, making ? `${p.name} is an admin now` : `${p.name} isn't an admin now`);
  }

  return (
    <Group id="people" title="People" note={people ? `${plural(people.length, "account")} on this server.` : undefined}>
      <Card>
        {!people ? (
          <p className={s.empty}>Looking…</p>
        ) : (
          <ul className={s.list}>
            {people.map((p) => {
              const self = p.id === me?.id;
              const items: MenuItem[] = [
                { label: p.role === "admin" ? "Remove as admin" : "Make admin", icon: "shield", onSelect: () => setRole(p) },
                ...(!self ? [{ label: "New password", icon: "key" as const, onSelect: () => resetPassword(p) }] : []),
                { label: self ? "Sign out other devices" : "Sign out everywhere", icon: "power", onSelect: () => signOut(p) },
                ...(!self
                  ? [
                      { divider: true, label: "" },
                      { label: p.suspended ? "Let them sign in again" : "Suspend", icon: "user-block" as const, onSelect: () => suspend(p) },
                      { label: "Remove account", icon: "trash" as const, onSelect: () => remove(p) },
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
                        {p.invitedBy && ` · invited by ${p.invitedBy}`} · {self ? "here now" : `seen ${ago(p.lastSeenAt, now)}`} · {plural(p.plays, "play")}
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
      {revealed && <p className={s.footnote}>Send it to them: it&apos;s only shown once. They can change it in their own Settings.</p>}
    </Group>
  );
}

// --- Features ---

function Features({ settings, save }: SectionProps) {
  const f = settings.features;
  const set = (key: keyof AdminSettings["features"], on: boolean, name: string) => save({ features: { [key]: on } }, `${name} ${on ? "on" : "off"} for everyone`);
  return (
    <Group id="features" title="Features" note="Switching one off hides it for everyone. People's own choices come back when it's switched on again.">
      <Card>
        <Row title="Super Processing" note="Learns from how each person listens, for their home screen, Spices and autoplay. Uses more storage and runs in the background.">
          <Switch checked={f.superProcessing} onChange={(on) => set("superProcessing", on, "Super Processing")} label="Super Processing" />
        </Row>
        <Row title="Autoplay" note="Keeps playing similar songs when someone's queue runs out.">
          <Switch checked={f.autoplay} onChange={(on) => set("autoplay", on, "Autoplay")} label="Autoplay" />
        </Row>
        <Row
          title={
            <>
              Harmoni <em>Link</em>
            </>
          }
          note="Play on one device and control it from another. Keeps a connection open per device."
        >
          <Switch checked={f.link} onChange={(on) => set("link", on, "Harmoni Link")} label="Harmoni Link" />
        </Row>
        <Row title="Lyrics" note="Synced and plain lyrics, from the lyrics providers below.">
          <Switch checked={f.lyrics} onChange={(on) => set("lyrics", on, "Lyrics")} label="Lyrics" />
        </Row>
      </Card>
    </Group>
  );
}

// --- Audio ---

function Audio({ settings, save }: SectionProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);
  const { data: stats } = useApi<AdminStats>("/api/admin/stats", version);
  const used = stats?.cache.bytes ?? 0;
  const limit = settings.cacheLimitGb * 1e9;

  async function empty() {
    const sure = await confirm({
      title: "Empty the audio cache?",
      note: `${stats ? `${bytes(used)} across ${plural(stats.cache.songs, "song")}. ` : ""}Songs stream from their source again the next time they're played, so they may take a moment longer to start.`,
      confirm: "Empty it",
      danger: true,
    });
    if (!sure) return;
    try {
      const { removed } = await api<{ removed: number }>("/api/admin/cache", { method: "DELETE" });
      toast(`Removed ${plural(removed, "song")} from the cache`);
    } catch {
      toast("Couldn't empty it.", "error");
    }
    setVersion((v) => v + 1);
  }

  return (
    <Group
      id="audio"
      title="Audio"
      note="Songs stream from YouTube Music as AAC (about 128 kbps, 44.1 kHz) and are kept on this server once played, so they start instantly next time."
    >
      <Card>
        <div className={s.row} style={{ display: "block" }}>
          <div className={s.rowTitle}>Audio cache</div>
          <div className={s.rowNote}>
            {stats ? (
              <>
                <strong>{bytes(used)}</strong> across {plural(stats.cache.songs, "song")}
                {limit ? ` of ${settings.cacheLimitGb} GB` : ""}.
              </>
            ) : (
              "Measuring…"
            )}
          </div>
          {limit > 0 && (
            <div className={`${s.meter} ${used >= limit ? s.meterFull : ""}`}>
              <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
            </div>
          )}
        </div>
        <Row wide title="Cache limit" note={settings.cacheLimitGb ? "Past this, the songs played longest ago make room." : "It grows as new songs are played."}>
          <Segmented
            label="Cache limit"
            value={settings.cacheLimitGb}
            onChange={(cacheLimitGb) => save({ cacheLimitGb }, cacheLimitGb ? `Cache limit: ${cacheLimitGb} GB` : "No cache limit")}
            options={[0, 2, 5, 10, 25, 50, 100].map((gb) => ({ value: gb, label: gb ? `${gb} GB` : "None" }))}
          />
        </Row>
        <Row title="Empty the cache" note="Frees the space now. Nothing in anyone's library changes.">
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={empty} disabled={!stats?.cache.songs}>
            <Icon name="trash" /> Empty
          </button>
        </Row>
      </Card>
    </Group>
  );
}

// --- Providers ---

const ROLE_WORDS: Record<ProviderRoleName, string> = { song: "Audio", search: "Search", lyrics: "Lyrics", artist: "Artists", discovery: "Recommendations" };

const KEY_LABELS: Record<string, string> = {
  lastfm: "API key",
  spotifyId: "Client ID",
  spotifySecret: "Client secret",
  tidalId: "Client ID",
  tidalSecret: "Client secret",
};

const KEY_NOTES: Record<string, string> = {
  lastfm: "More to go on for Super Processing and autoplay: similar songs and artists. Free from last.fm/api.",
  spotify: "Spotify's catalogue for search and matching songs. From developer.spotify.com.",
  tidal: "TIDAL's catalogue for search and matching songs. From developer.tidal.com.",
};

const KEYS_OF: Record<string, string[]> = { lastfm: ["lastfm"], spotify: ["spotifyId", "spotifySecret"], tidal: ["tidalId", "tidalSecret"] };

// Providers with `role`, in the order they're tried: the saved order first,
// then the rest as the server lists them.
function ordered(settings: AdminSettings, role: ProviderRoleName, saved: string[]) {
  const withRole = settings.providers.filter((p) => p.enabled && p.roles.includes(role));
  const rank = (prefix: string) => (saved.includes(prefix) ? saved.indexOf(prefix) : saved.length + withRole.findIndex((p) => p.prefix === prefix));
  return withRole.sort((a, b) => rank(a.prefix) - rank(b.prefix));
}

function Order({ title, note, list, onChange }: { title: string; note: string; list: AdminSettings["providers"]; onChange: (order: string[]) => void }) {
  const move = (i: number, by: number) => {
    const next = list.map((p) => p.prefix);
    next.splice(i + by, 0, ...next.splice(i, 1));
    onChange(next);
  };
  return (
    <Card>
      <Row title={title} note={note} />
      {list.length === 0 ? (
        <p className={s.empty}>None switched on.</p>
      ) : (
        <ol className={s.list} style={{ borderTop: "1px solid var(--border)" }}>
          {list.map((p, i) => (
            <li key={p.prefix} className={s.item}>
              <span className={`${s.avatar} tabular`}>{i + 1}</span>
              <div className={s.itemText}>
                <div className={s.itemTitle}>{p.name}</div>
              </div>
              <IconButton icon="arrow-up" label={`Try ${p.name} sooner`} onClick={() => move(i, -1)} disabled={i === 0} />
              <IconButton icon="arrow-down" label={`Try ${p.name} later`} onClick={() => move(i, 1)} disabled={i === list.length - 1} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Providers({ settings, save }: SectionProps) {
  const confirm = useConfirm();

  async function toggle(p: AdminSettings["providers"][number], on: boolean) {
    const playable = settings.providers.filter((x) => x.enabled && x.roles.includes("song"));
    if (!on && p.roles.includes("song") && playable.length === 1) {
      const sure = await confirm({
        title: `Switch off ${p.name}?`,
        note: "It's the only place songs play from here: nothing new will play until it's back on. Songs already in the audio cache still will.",
        confirm: "Switch off",
        danger: true,
      });
      if (!sure) return;
    }
    const disabled = on ? settings.disabledProviders.filter((x) => x !== p.prefix) : [...settings.disabledProviders, p.prefix];
    await save({ disabledProviders: disabled }, `${p.name} ${on ? "on" : "off"}`);
  }

  // Keyed providers, configured or not.
  const keyed = ["lastfm", "spotify", "tidal"].map((prefix) => ({
    prefix,
    name: settings.providers.find((p) => p.prefix === prefix)?.name ?? settings.needKeys.find((p) => p.prefix === prefix)?.name ?? prefix,
    keys: KEYS_OF[prefix],
  }));

  return (
    <Group id="providers" title="Providers" note="Where Harmoni finds music, audio, lyrics and recommendations.">
      <Card>
        <ul className={s.list}>
          {settings.providers.map((p) => (
            <li key={p.prefix} className={s.item}>
              <div className={s.itemText}>
                <div className={s.itemTitle}>{p.name}</div>
                <div className={s.itemMeta}>{p.roles.map((r) => ROLE_WORDS[r]).join(" · ")}</div>
              </div>
              <Switch checked={p.enabled} onChange={(on) => toggle(p, on)} label={p.name} />
            </li>
          ))}
        </ul>
      </Card>
      <Order
        title="Where songs play from"
        note="When a song is on more than one, the first that answers plays it."
        list={ordered(settings, "song", settings.songOrder)}
        onChange={(songOrder) => save({ songOrder })}
      />
      <Order
        title="Where lyrics come from"
        note="Asked in this order. Synced lyrics win over plain ones from earlier."
        list={ordered(settings, "lyrics", settings.lyricsOrder)}
        onChange={(lyricsOrder) => save({ lyricsOrder })}
      />
      {keyed.map((k) => (
        <KeyCard key={k.prefix} name={k.name} note={KEY_NOTES[k.prefix]} keys={k.keys} settings={settings} save={save} />
      ))}
    </Group>
  );
}

function KeyCard({ name, note, keys, settings, save }: { name: string; note: string; keys: string[] } & SectionProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const status = keys.map((k) => settings.keys[k]);
  const set = status.every((x) => x?.set);
  const own = status.some((x) => x?.set && !x.fromEnv);
  const fromEnv = set && status.every((x) => x?.fromEnv);
  const ready = keys.every((k) => drafts[k]?.trim() || settings.keys[k]?.set);
  const dirty = keys.some((k) => drafts[k]?.trim());

  return (
    <Card>
      <Row
        title={
          <span className={s.itemTitle}>
            {name}
            {set ? <Badge tone="accent">{fromEnv ? "Set by the environment" : "Connected"}</Badge> : <Badge>Not set up</Badge>}
          </span>
        }
        note={note}
      >
        {own && (
          <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={() => save({ keys: Object.fromEntries(keys.map((k) => [k, ""])) }, `${name} keys removed`)}>
            Remove
          </button>
        )}
      </Row>
      <form
        className={s.field}
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty || !ready) return;
          void save({ keys: Object.fromEntries(keys.filter((k) => drafts[k]?.trim()).map((k) => [k, drafts[k].trim()])) }, `${name} saved`);
          setDrafts({});
        }}
      >
        {keys.map((k) => (
          <input
            key={k}
            className={s.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={settings.keys[k]?.set ? `${KEY_LABELS[k]}: ${settings.keys[k].hint ?? "set"} (type to replace)` : KEY_LABELS[k]}
            aria-label={`${name} ${KEY_LABELS[k]}`}
            value={drafts[k] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
          />
        ))}
        {dirty && (
          <div className={s.fieldFoot}>
            <span>{ready ? "Saved on this server, never shown again." : "Both are needed."}</span>
            <button className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`} disabled={!ready}>
              Save
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}
