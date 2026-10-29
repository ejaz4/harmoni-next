"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary, useNewCollection } from "@/components/providers/library";
import { useSettings } from "@/components/providers/settings";
import { CardLink } from "@/components/song/song-card";
import { SpiceCardLink } from "@/components/spice/spice-card";
import { EmptyState, Section, ui } from "@/components/ui";
import { plural } from "@/lib/format";
import styles from "../pages.module.css";

// Everything the desktop sidebar holds, for phones, where there's no sidebar.
export default function LibraryPage() {
  const library = useLibrary();
  const { newPlaylist, newSpice } = useNewCollection();
  const { settings } = useSettings();

  return (
    <>
      <h1 className={styles.pageTitle}>Library</h1>
      <ul className={styles.libraryLinks}>
        <LibraryLink href="/liked" icon="heart" label="Liked Songs" />
        <LibraryLink href="/recent" icon="history" label="Recently Played" />
        <LibraryLink href="/settings" icon="settings" label="Settings" />
        {settings.developerMode && <LibraryLink href="/debug" icon="music" label="Debug" />}
      </ul>

      <Section title="Playlists">
        <div className={styles.newCollection}>
          <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={newPlaylist}>
            <Icon name="plus" /> New playlist
          </button>
          <button type="button" className={ui.button} onClick={newSpice}>
            <Icon name="spice" /> New Spice
          </button>
        </div>
        {library.collections.length === 0 ? (
          <EmptyState title="No playlists yet" body="Make one here, or add a song to a new playlist from its menu." />
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
    </>
  );
}

function LibraryLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <li>
      <Link href={href} className={styles.libraryLink}>
        <Icon name={icon} />
        <span>{label}</span>
        <Icon name="arrow-left" className={styles.libraryChevron} />
      </Link>
    </li>
  );
}
