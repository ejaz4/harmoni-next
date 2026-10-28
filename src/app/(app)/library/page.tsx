"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/icon";
import { useLibrary } from "@/components/providers/library";
import { usePrompt } from "@/components/providers/prompt";
import { useSettings } from "@/components/providers/settings";
import { CardLink } from "@/components/song/song-card";
import { EmptyState, Section, ui } from "@/components/ui";
import { plural } from "@/lib/format";
import styles from "../pages.module.css";

// Everything the desktop sidebar holds, for phones, where there's no sidebar.
export default function LibraryPage() {
  const library = useLibrary();
  const prompt = usePrompt();
  const router = useRouter();
  const { settings } = useSettings();

  async function newPlaylist() {
    const name = await prompt({ title: "New playlist", label: "Name it", confirm: "Create" });
    if (!name) return;
    const id = await library.createPlaylist(name);
    if (id) router.push(`/playlist/${id}`);
  }

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
        <button type="button" className={`${ui.button} ${ui.buttonPrimary}`} onClick={newPlaylist} style={{ marginBottom: 20 }}>
          <Icon name="plus" /> New playlist
        </button>
        {library.playlists.length === 0 ? (
          <EmptyState title="No playlists yet" body="Make one here, or add a song to a new playlist from its menu." />
        ) : (
          <div className={ui.cardGrid}>
            {library.playlists.map((p) => (
              <CardLink key={p.id} href={`/playlist/${p.id}`} artwork={p.artworks[0]} title={p.name} subtitle={plural(p.count, "song")} />
            ))}
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
