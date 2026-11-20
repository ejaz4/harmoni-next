"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary, useNewCollection } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { useUser } from "@/components/providers/user";
import { collectionHref, useCollectionMenu, useCollectionPlayer, type CollectionRef } from "@/components/song/collection-menu";
import { CollectionCard } from "@/components/song/song-card";
import { SpiceArt } from "@/components/spice/spice-art";
import { SpiceCardLink } from "@/components/spice/spice-card";
import { useDailySpice } from "@/components/spice/use-daily-spice";
import { Artwork, EmptyState, Menu, PlayButton, ui, useContextMenu } from "@/components/ui";
import { plural } from "@/lib/format";
import { profilePath } from "@/lib/share";
import styles from "./library.module.css";

type Filter = "all" | "playlists" | "spices" | "shared";
type Order = "recent" | "name";

// Everything that's yours, like the phone app's Library tab: the lists that
// are always there, then your playlists and Spices, then what people share.
export default function LibraryPage() {
  const library = useLibrary();
  const { newPlaylist, newSpice } = useNewCollection();
  const { settings } = useSettings();
  const daily = useDailySpice();
  const user = useUser();
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<Order>("recent");

  const playlists = library.collections.filter((c) => c.type === "playlist").length;
  const spices = library.collections.length - playlists;
  const summary = [playlists ? plural(playlists, "playlist") : "", spices ? plural(spices, "Spice") : "", library.shared.length ? `${library.shared.length} shared with you` : ""].filter(Boolean).join(" · ") || "Nothing here yet";

  const name = (c: (typeof library.collections)[number]) => (c.type === "playlist" ? c.playlist.name : c.spice.name);
  const own = library.collections
    .filter((c) => filter === "all" || (filter === "playlists" ? c.type === "playlist" : filter === "spices" ? c.type === "spice" : false))
    .sort((a, b) => (order === "name" ? name(a).localeCompare(name(b)) : 0));
  const shared = filter === "all" || filter === "shared" ? [...library.shared].sort((a, b) => (order === "name" ? a.name.localeCompare(b.name) : 0)) : [];

  const newItems = [
    { label: "New Playlist", icon: "playlist" as const, detail: "Songs you pick, in your order", onSelect: () => void newPlaylist() },
    { label: "New Spice", icon: "spice" as const, detail: "A mix that grows from a few songs", onSelect: () => void newSpice() },
  ];

  return (
    <div className={ui.reveal}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your Library</h1>
          <p className={styles.summary}>{summary}</p>
        </div>
        <Menu text="New" icon="plus" label="New playlist or Spice" className={styles.newButton} items={newItems} />
      </header>

      <div className={styles.pinned}>
        <Pinned collection={{ kind: "liked", name: "Liked Songs" }} detail="Every song you've hearted" art={<Tile icon="heart-solid" tone="liked" />} />
        <Pinned collection={{ kind: "recent", name: "Recently Played" }} detail="What you've played lately" art={<Tile icon="history" tone="recent" />} />
        {daily && (
          <Pinned
            collection={{ kind: "spice", id: "daily", name: daily.label }}
            detail={`Spice · ${daily.part}, from how you listen`}
            art={<SpiceArt name={daily.label} label={false} />}
          />
        )}
        {/* Phones have no account menu: these live here instead. */}
        {user && <Row href={profilePath(user.username)} icon="user" label="Your profile" />}
        <Row href="/settings" icon="settings" label="Settings" />
        {settings.developerMode && <Row href="/debug" icon="music" label="Debug" />}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.chips} role="tablist" aria-label="Show">
          {(
            [
              ["all", "All"],
              ["playlists", "Playlists"],
              ["spices", "Spices"],
              ...(library.shared.length ? [["shared", "Shared with you"]] : []),
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={filter === value} className={styles.chip} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <Menu
          text={order === "recent" ? "Recent" : "A to Z"}
          icon="sort"
          label="Sort"
          items={[
            { label: "Recently changed", icon: "history", checked: order === "recent", onSelect: () => setOrder("recent") },
            { label: "Name", icon: "sort", checked: order === "name", onSelect: () => setOrder("name") },
          ]}
        />
      </div>

      {own.length === 0 && shared.length === 0 ? (
        <EmptyState
          icon="playlist"
          title={filter === "spices" ? "No Spices yet" : "No playlists yet"}
          body="Make a playlist or a Spice with New, or add a song to one from its menu."
        />
      ) : (
        <div className={`${ui.cardGrid} ${styles.grid}`} key={`${filter}-${order}`}>
          {own.map((c) =>
            c.type === "playlist" ? (
              <CollectionCard
                key={c.playlist.id}
                collection={{ kind: "playlist", id: c.playlist.id, name: c.playlist.name }}
                art={<Artwork src={c.playlist.artworks[0]} alt="" radius="lg" />}
                subtitle={`Playlist · ${plural(c.playlist.count, "song")}`}
              />
            ) : (
              <SpiceCardLink key={c.spice.id} spice={c.spice} />
            ),
          )}
          {shared.map((p) => (
            <CollectionCard
              key={p.id}
              collection={{ kind: "playlist", id: p.id, name: p.name, shareable: true }}
              art={<Artwork src={p.artworks[0]} alt="" radius="lg" />}
              subtitle={`${p.owner.name} · ${plural(p.count, "song")}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ icon, tone }: { icon: IconName; tone: "liked" | "recent" }) {
  return (
    <span className={styles.tile} data-tone={tone}>
      <Icon name={icon} />
    </span>
  );
}

// One of the lists that's always there: a wide tile on desktop, a row on phones.
function Pinned({ collection, detail, art }: { collection: CollectionRef; detail: string; art: ReactNode }) {
  const { run, isLoading } = useCollectionPlayer();
  const collectionMenu = useCollectionMenu();
  const contextMenu = useContextMenu();
  return (
    <div className={styles.pin} onContextMenu={(e) => contextMenu(e, () => collectionMenu(collection))}>
      <span className={styles.pinArt}>{art}</span>
      <span className={styles.pinText}>
        <Link href={collectionHref(collection)} className={styles.pinName}>
          {collection.name}
        </Link>
        <span className={styles.pinDetail}>{detail}</span>
      </span>
      <PlayButton className={styles.pinPlay} playing={isLoading(collection)} onClick={() => void run(collection)} label={`Play ${collection.name}`} />
      <Icon name="caret-right" className={styles.chevron} />
    </div>
  );
}

function Row({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link href={href} className={styles.row}>
      <Icon name={icon} className={styles.rowIcon} />
      <span>{label}</span>
      <Icon name="caret-right" className={styles.chevron} />
    </Link>
  );
}
