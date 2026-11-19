"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLibrary } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { useUpdatePreferences } from "@/components/providers/user";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { findItems, useFind } from "@/components/song/find";
import { SongList } from "@/components/song/song-list";
import { SortMenu, sortItems, useSongSort } from "@/components/song/sort";
import { SpiceArt } from "@/components/spice/spice-art";
import { EmptyState, IconButton, Menu, Section, ui, type MenuItem } from "@/components/ui";
import { api } from "@/lib/api";
import { deviceTimeZone } from "@/lib/day-part";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { SpicePage } from "@/server/discovery/spice";
import styles from "../../pages.module.css";

export default function SpiceRoute() {
  return (
    <Suspense fallback={<CollectionSkeleton />}>
      <SpiceContent />
    </Suspense>
  );
}

function SpiceContent() {
  const { id } = useParams<{ id: string }>();
  const library = useLibrary();
  const prompt = usePrompt();
  const toast = useToast();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const updatePreferences = useUpdatePreferences();
  // Opening it is what remakes it: once a day, or (Daily) each part of the day.
  const tz = deviceTimeZone();
  const { data, error, reload } = useApi<SpicePage>(`/api/spices/${id}${tz ? `?tz=${encodeURIComponent(tz)}` : ""}`, library.version);
  // Left open, a Spice turns over when it expires.
  const expiresAt = data?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(reload, Math.max(60_000, new Date(expiresAt).getTime() - Date.now() + 5000));
    return () => clearTimeout(timer);
  }, [expiresAt, reload]);
  const [sort, setSort] = useSongSort(`spice:${id}`, { field: "order", descending: false });
  const find = useFind(`spice:${id}`, "Find in Spice");

  if (error) return <EmptyState title="Spice not found" body="It may have been deleted, or it belongs to someone else." />;
  if (!data) return <SpiceSkeleton daily={id === "daily"} />;
  const custom = data.kind === "custom";
  const daily = data.daily;
  const sorted = sortItems(data.songs, (s) => s, sort);
  const songs = findItems(sorted, (s) => s, find.query);

  async function snapshot() {
    setSaving(true);
    try {
      const playlist = await api<{ id: string; name: string }>(`/api/spices/${id}/snapshot`, { method: "POST" });
      await library.refreshPlaylists();
      toast(`Saved as ${playlist.name}`);
    } catch {
      toast("Couldn't save it as a playlist.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function rename() {
    const name = await prompt({ title: "Rename Spice", label: "Name", defaultValue: data!.name });
    if (!name) return;
    await api(`/api/spices/${id}`, { method: "PATCH", json: { name } });
    await library.refreshSpices();
    reload();
  }

  async function remove() {
    if (!window.confirm(`Delete “${data!.name}”? This can't be undone.`)) return;
    await api(`/api/spices/${id}`, { method: "DELETE" });
    await library.refreshSpices();
    toast(`Deleted ${data!.name}`);
    router.push("/library");
  }

  const options: MenuItem[] = [
    { label: "Save as playlist", icon: "snapshot", onSelect: snapshot },
    ...(custom
      ? [
          { label: "Change its songs", icon: "spice" as const, onSelect: () => router.push(`/spice/${id}/seeds`) },
          { label: "Rename", icon: "edit" as const, onSelect: rename },
          { label: "Delete Spice", icon: "trash" as const, onSelect: remove },
        ]
      : []),
  ];

  return (
    <>
      <CollectionHeader
        kind="Spice"
        title={data.name}
        description={
          daily
            ? dailyDescription(daily)
            : custom
              ? `Grown from ${plural(data.seedCount ?? 0, "seed song")}, and different every day.`
              : "Picked for you from what you listen to, and different every day."
        }
        meta={data.expiresAt && <Countdown to={data.expiresAt} />}
        songs={sorted}
        artwork={<SpiceArt name={data.name} covers={data.covers} />}
        actions={
          <>
            <IconButton icon="snapshot" label={saving ? "Saving…" : "Save as playlist"} onClick={snapshot} disabled={saving || !data.songs.length} size={22} className={styles.notOnPhones} />
            <Menu label="Spice options" items={options} />
          </>
        }
        trailing={
          sorted.length > 1 && (
            <>
              {find.field(songs.length)}
              <SortMenu sort={sort} onChange={setSort} orderLabel="Spice order" orderIcon="spice" />
            </>
          )
        }
      />

      {daily?.needsSuperProcessing ? (
        <EmptyState
          title="Made from how you listen"
          body="Your Spice follows your day: what you play in the mornings, the afternoons and late at night. It needs Super Processing to learn that."
          action={
            <button
              type="button"
              className={`${ui.button} ${ui.buttonPrimary}`}
              onClick={() => updatePreferences({ superProcessing: true }).then(reload, () => toast("Couldn't turn on Super Processing.", "error"))}
            >
              Turn on Super Processing
            </button>
          }
        />
      ) : songs.length ? (
        <SongList songs={songs} numbered />
      ) : find.query ? (
        <EmptyState title="No matches" body={`Nothing in this Spice matches “${find.query.trim()}”.`} />
      ) : daily ? (
        <EmptyState title="Still getting to know you" body="Play some music and your Spice fills in with what suits each part of your day." />
      ) : custom ? (
        <EmptyState
          title="Plant a seed"
          body="Pick a few songs you love and Harmoni grows the rest from there."
          action={
            <Link href={`/spice/${id}/seeds`} className={`${ui.button} ${ui.buttonPrimary}`}>
              Pick songs
            </Link>
          }
        />
      ) : (
        <EmptyState title="Nothing in this one yet" body="Its sources didn't come back with anything. Try again in a little while." />
      )}

      {custom && data.seeds.length > 0 && (
        <Section
          title="Grown from"
          action={
            <Link href={`/spice/${id}/seeds`} className={`${ui.button} ${ui.buttonSmall}`}>
              Change
            </Link>
          }
        >
          <p className={styles.sectionNote}>The songs this Spice grows from. Change them and it remakes itself next time you open it.</p>
          <SongList
            songs={data.seeds}
            rowMenu={(song) => [
              {
                label: "Remove from seeds",
                icon: "trash",
                onSelect: async () => {
                  await api(`/api/spices/${id}/seeds/${song.id}`, { method: "DELETE" });
                  await library.refreshSpices();
                  reload();
                },
              },
            ]}
          />
        </Section>
      )}
    </>
  );
}

// "New Spice in 3h 12m", ticking down. Set after mounting, since the server
// render can't know the time it'll be shown.
function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  return <span suppressHydrationWarning>{countdown(new Date(to).getTime() - now)}</span>;
}

function countdown(ms: number): string {
  if (ms <= 0) return "New Spice on the way";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `New Spice in ${h}h ${m}m`;
  if (m) return `New Spice in ${m}m ${s % 60}s`;
  return `New Spice in ${s}s`;
}

function dailyDescription(daily: NonNullable<SpicePage["daily"]>): string {
  return `What you play ${whenPhrase(daily.part)}${daily.source ? `, with a dash of ${daily.source.name}` : ""}.`;
}

// "Morning" → "in the mornings", "Friday Night" → "on Friday nights".
function whenPhrase(part: string): string {
  const weekday = part.match(/^(\w+day) (\w+)$/);
  if (weekday) return `on ${weekday[1]} ${weekday[2].toLowerCase()}s`;
  if (part === "Late Night") return "late at night";
  return `in the ${part.toLowerCase()}s`;
}

// Making one for the first time takes a moment.
function SpiceSkeleton({ daily }: { daily: boolean }) {
  return (
    <>
      <CollectionSkeleton />
      <p className={styles.sectionNote}>
        {daily ? "Grinding your Spice… picking what suits this time of day." : "Grinding your Spice… finding songs that go with the ones you picked."}
      </p>
    </>
  );
}
