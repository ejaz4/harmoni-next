"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary, useNewCollection } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { useUser } from "@/components/providers/user";
import { CardLink } from "@/components/song/song-card";
import { DAILY_SPICE_HREF, useDailySpice } from "@/components/spice/use-daily-spice";
import { SpiceCardLink } from "@/components/spice/spice-card";
import { EmptyState, Menu, Section, ui } from "@/components/ui";
import { plural } from "@/lib/format";
import { profilePath } from "@/lib/share";
import styles from "../pages.module.css";

// Everything the desktop sidebar holds, for phones, where there's no sidebar.
export default function LibraryPage() {
  const library = useLibrary();
  const { newPlaylist, newSpice } = useNewCollection();
  const { settings } = useSettings();
  const daily = useDailySpice();
  const user = useUser();

  return (
    <>
      <h1 className={styles.pageTitle}>Library</h1>
      <ul className={styles.libraryLinks}>
        <LibraryLink href="/liked" icon="heart" label="Liked Songs" />
        <LibraryLink href="/recent" icon="history" label="Recently Played" />
        {daily && <LibraryLink href={DAILY_SPICE_HREF} icon="spice" label={daily.label} detail={daily.part} />}
        {user && <LibraryLink href={profilePath(user.username)} icon="user" label="Your profile" />}
        <LibraryLink href="/settings" icon="settings" label="Settings" />
        {settings.developerMode && <LibraryLink href="/debug" icon="music" label="Debug" />}
      </ul>

      <Section
        title="Playlists"
        action={
          <Menu
            text="New"
            icon="plus"
            label="New playlist or Spice"
            items={[
              { label: "New Spice", icon: "spice", onSelect: () => void newSpice() },
              { label: "New Playlist", icon: "playlist", onSelect: () => void newPlaylist() },
            ]}
          />
        }
      >
        {library.collections.length === 0 ? (
          <EmptyState title="No playlists yet" body="Tap New to make a playlist or a Spice, or add a song to one from its menu." />
        ) : (
          <div className={ui.cardGrid}>
            {library.collections.map((c) =>
              c.type === "playlist" ? (
                <CardLink
                  key={c.playlist.id}
                  href={`/playlist/${c.playlist.id}`}
                  artwork={c.playlist.artworks[0]}
                  title={c.playlist.name}
                  subtitle={`Playlist · ${plural(c.playlist.count, "song")}`}
                />
              ) : (
                <SpiceCardLink key={c.spice.id} spice={c.spice} />
              ),
            )}
          </div>
        )}
      </Section>

      {library.shared.length > 0 && (
        <Section title="Shared with you">
          <div className={ui.cardGrid}>
            {library.shared.map((p) => (
              <CardLink key={p.id} href={`/playlist/${p.id}`} artwork={p.artworks[0]} title={p.name} subtitle={`${p.owner.name} · ${plural(p.count, "song")}`} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function LibraryLink({ href, icon, label, detail }: { href: string; icon: IconName; label: string; detail?: string }) {
  return (
    <li>
      <Link href={href} className={styles.libraryLink}>
        <Icon name={icon} />
        <span>
          {label}
          {detail && <span className={styles.libraryLinkDetail}>{detail}</span>}
        </span>
        <Icon name="arrow-left" className={styles.libraryChevron} />
      </Link>
    </li>
  );
}
