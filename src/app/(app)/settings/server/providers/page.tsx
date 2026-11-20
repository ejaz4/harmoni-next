"use client";

import { useState } from "react";
import { useConfirm } from "@/components/providers/prompt";
import { IconButton, ui } from "@/components/ui";
import type { AdminSettings, ProviderRoleName } from "@/lib/admin";
import { Badge, Card, Group, Row, settingsStyles as s, Switch } from "../../parts";
import { AdminPage, type Save } from "../admin";

export default function ProvidersPage() {
  return (
    <AdminPage title="Providers" description="Where Harmoni gets audio, search results, lyrics and recommendations.">
      {(settings, save) => <Providers settings={settings} save={save} />}
    </AdminPage>
  );
}

const ROLE_WORDS: Record<ProviderRoleName, string> = { song: "Audio", search: "Search", lyrics: "Lyrics", artist: "Artists", discovery: "Recommendations" };

const KEY_LABELS: Record<string, string> = {
  lastfm: "API key",
  spotifyId: "Client ID",
  spotifySecret: "Client secret",
  tidalId: "Client ID",
  tidalSecret: "Client secret",
};

const KEY_NOTES: Record<string, string> = {
  lastfm: "Similar songs and artists for Super Processing and Autoplay. Get a free key at last.fm/api.",
  spotify: "Spotify's catalogue for search and matching. Get keys at developer.spotify.com.",
  tidal: "TIDAL's catalogue for search and matching. Get keys at developer.tidal.com.",
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
        <p className={s.empty}>No sources turned on.</p>
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

function Providers({ settings, save }: { settings: AdminSettings; save: Save }) {
  const confirm = useConfirm();

  async function toggle(p: AdminSettings["providers"][number], on: boolean) {
    const playable = settings.providers.filter((x) => x.enabled && x.roles.includes("song"));
    if (!on && p.roles.includes("song") && playable.length === 1) {
      const sure = await confirm({
        title: `Turn off ${p.name}?`,
        note: "It's the only audio source, so only cached songs will play until it's back on.",
        confirm: "Turn off",
        danger: true,
      });
      if (!sure) return;
    }
    const disabled = on ? settings.disabledProviders.filter((x) => x !== p.prefix) : [...settings.disabledProviders, p.prefix];
    await save({ disabledProviders: disabled }, `${p.name} turned ${on ? "on" : "off"}`);
  }

  // Keyed providers, configured or not.
  const keyed = ["lastfm", "spotify", "tidal"].map((prefix) => ({
    prefix,
    name: settings.providers.find((p) => p.prefix === prefix)?.name ?? settings.needKeys.find((p) => p.prefix === prefix)?.name ?? prefix,
    keys: KEYS_OF[prefix],
  }));

  return (
    <>
      <Group id="sources" title="Sources">
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
      </Group>
      <Group id="order" title="Priority">
        <Order
          title="Audio"
          note="When a song is on more than one source, the first that has it plays it."
          list={ordered(settings, "song", settings.songOrder)}
          onChange={(songOrder) => save({ songOrder })}
        />
        <Order
          title="Lyrics"
          note="Tried in this order. Synced lyrics are preferred over plain ones."
          list={ordered(settings, "lyrics", settings.lyricsOrder)}
          onChange={(lyricsOrder) => save({ lyricsOrder })}
        />
      </Group>
      <Group id="keys" title="API keys">
        {keyed.map((k) => (
          <KeyCard key={k.prefix} name={k.name} note={KEY_NOTES[k.prefix]} keys={k.keys} settings={settings} save={save} />
        ))}
      </Group>
    </>
  );
}

function KeyCard({ name, note, keys, settings, save }: { name: string; note: string; keys: string[]; settings: AdminSettings; save: Save }) {
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
            {set ? <Badge tone="accent">{fromEnv ? "Set in environment" : "Connected"}</Badge> : <Badge>Not set up</Badge>}
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
            <span>{ready ? "Stored on this server and never shown again." : "Both fields are required."}</span>
            <button className={`${ui.button} ${ui.buttonSmall} ${ui.buttonPrimary}`} disabled={!ready}>
              Save
            </button>
          </div>
        )}
      </form>
    </Card>
  );
}
