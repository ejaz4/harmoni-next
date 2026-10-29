"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLibrary } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { CollectionHeader, CollectionSkeleton } from "@/components/song/collection";
import { SongList } from "@/components/song/song-list";
import { SortMenu, sortItems, useSongSort } from "@/components/song/sort";
import { SpiceArt } from "@/components/spice/spice-art";
import { EmptyState, IconButton, Menu, Section, type MenuItem } from "@/components/ui";
import { api } from "@/lib/api";
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
  // Opening it is what remakes it, once a day.
  const { data, error, reload } = useApi<SpicePage>(`/api/spices/${id}`, library.version);
  const [sort, setSort] = useSongSort(`spice:${id}`, { field: "order", descending: false });

  if (error) return <EmptyState title="Spice not found" body="It may have been deleted, or it belongs to someone else." />;
  if (!data) return <SpiceSkeleton />;
  const custom = data.kind === "custom";
  const songs = sortItems(data.songs, (s) => s, sort);

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
          custom
            ? `Grown from ${plural(data.seedCount ?? 0, "seed song")}, and different every day.`
            : "Picked for you from what you listen to, and different every day."
        }
        meta={freshness(data.generatedAt)}
        songs={songs}
        artwork={<SpiceArt name={data.name} covers={data.covers} />}
        actions={
          <>
            <IconButton icon="snapshot" label={saving ? "Saving…" : "Save as playlist"} onClick={snapshot} disabled={saving || !data.songs.length} size={22} />
            <Menu label="Spice options" items={options} />
          </>
        }
        trailing={songs.length > 1 && <SortMenu sort={sort} onChange={setSort} orderLabel="Spice order" orderIcon="spice" />}
      />

      {data.songs.length ? (
        <SongList songs={songs} numbered />
      ) : custom ? (
        <EmptyState title="Plant a seed" body="Open any song's ••• menu and choose Add to Spice. Harmoni grows the rest from there." />
      ) : (
        <EmptyState title="Nothing in this one yet" body="Its sources didn't come back with anything. Try again in a little while." />
      )}

      {custom && data.seeds.length > 0 && (
        <Section title="Seeds">
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

function freshness(at?: string): string | undefined {
  if (!at) return undefined;
  const hours = (Date.now() - new Date(at).getTime()) / 3_600_000;
  return hours < 1 ? "Made just now" : hours < 24 ? "Made today" : "Made yesterday";
}

// Making one for the first time takes a moment.
function SpiceSkeleton() {
  return (
    <>
      <CollectionSkeleton />
      <p className={styles.sectionNote}>Grinding your Spice…</p>
    </>
  );
}
