"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { Artwork, ui } from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";
import { spiceName } from "@/lib/spice-name";
import { useSongSearch } from "@/lib/search-stream";
import { useApi } from "@/lib/use-api";
import type { SongResult } from "@/server/library/song-view";
import { spiceDraft, startSpiceWith } from "./draft";
import { SpiceArt } from "./spice-art";
import styles from "./seed-picker.module.css";

// Picking the songs a Spice grows from, step by step: songs from their own
// listening to tap, a search for anything else, and the Spice taking shape
// at the bottom as they go, named after what's in it unless they'd rather
// call it something.

const ENOUGH = 3;

export function SeedPicker({
  kind,
  title,
  intro,
  initial,
  name: initialName,
  action,
  onDone,
}: {
  kind: string;
  title: string;
  intro: string;
  initial?: SongResult[];
  name?: string; // its name, if someone chose it; otherwise it's named after the seeds
  action: string;
  onDone: (seeds: SongResult[], name: string | undefined) => Promise<void>;
}) {
  const [picks, setPicks] = useState<SongResult[]>(() => initial ?? spiceDraft());
  const [name, setName] = useState(initialName ?? "");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: suggestions } = useApi<SongResult[]>("/api/spices/suggestions");
  const { results, searching } = useSongSearch(query);

  const picked = new Set(picks.map((s) => s.id));
  const toggle = (song: SongResult) => setPicks((p) => (picked.has(song.id) ? p.filter((s) => s.id !== song.id) : [...p, song]));
  const autoName = spiceName(picks);
  const covers = [...new Set(picks.flatMap((s) => (s.artworkUrl ? [s.artworkUrl] : [])))];
  const hint = !picks.length ? "Pick a song to start" : picks.length < ENOUGH ? "Add a couple more" : "Ready when you are";

  const list = query.trim() ? results : (suggestions ?? []);
  const loading = query.trim() ? searching && !results.length : !suggestions;

  async function done() {
    setBusy(true);
    try {
      await onDone(picks, name.trim() || undefined);
      startSpiceWith([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.picker}>
      <header className={styles.intro}>
        <span className={styles.kind}>{kind}</span>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{intro}</p>
      </header>

      {picks.length > 0 && (
        <ul className={styles.picks} aria-label="Seed songs">
          {picks.map((song) => (
            <li key={song.id} className={styles.pick}>
              <Artwork src={song.artworkUrl} size={28} radius="sm" />
              <span className={styles.pickTitle}>{song.title}</span>
              <button type="button" className={styles.unpick} onClick={() => toggle(song)} aria-label={`Remove ${song.title}`}>
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.search} role="search">
        <Icon name="search" className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a song to add"
          aria-label="Search for a song to add"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        {query && (
          <button type="button" className={styles.searchClear} onClick={() => setQuery("")} aria-label="Clear">
            <Icon name="close" />
          </button>
        )}
      </div>

      {(loading || list.length > 0) && <h2 className={styles.listTitle}>{query.trim() ? "Songs" : "From your listening"}</h2>}
      {loading ? (
        <ul className={styles.rows} aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={styles.row}>
              <div className={ui.skeleton} style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)" }} />
              <div className={styles.rowText}>
                <div className={ui.skeleton} style={{ height: 13, width: `${40 + ((i * 17) % 35)}%`, marginBottom: 7 }} />
                <div className={ui.skeleton} style={{ height: 11, width: `${25 + ((i * 11) % 20)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : list.length ? (
        <ul className={styles.rows}>
          {list.map((song) => {
            const on = picked.has(song.id);
            return (
              <li key={song.id}>
                <button type="button" className={styles.row} data-picked={on || undefined} onClick={() => toggle(song)} aria-pressed={on}>
                  <Artwork src={song.artworkUrl} size={44} radius="sm" />
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>
                      {song.title}
                      {song.explicit && <span className={styles.explicit}>E</span>}
                    </span>
                    <span className={styles.rowMeta}>{song.artists.map((a) => a.name).join(", ")}</span>
                  </span>
                  <span className={styles.mark} aria-hidden>
                    <Icon name={on ? "check" : "plus"} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>
          {query.trim() ? `Nothing turned up for “${query.trim()}”. Try the artist's name on its own.` : "Start by searching for a song you love. Once you've been listening a while, your favourites show up here to pick from."}
        </p>
      )}

      <div className={styles.tray}>
        <div className={styles.trayArt}>
          <SpiceArt name={name.trim() || autoName} covers={covers} label={false} />
        </div>
        <div className={styles.trayText}>
          <input
            className={styles.name}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder={picks.length ? autoName : "Your Spice"}
            aria-label="Name (optional)"
            title="Named after its songs, unless you'd like to call it something"
            enterKeyHint="done"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <span className={styles.hint}>{hint}</span>
        </div>
        <button type="button" className={`${ui.button} ${ui.buttonPrimary} ${styles.go}`} disabled={!picks.length || busy} onClick={done}>
          {busy ? <Spinner /> : <Icon name="spice" />}
          {action}
        </button>
      </div>
    </div>
  );
}
