"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "@/components/icon";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { readAppleLibrary } from "@/lib/apple-library";
import type { ImportLibrary, ImportProgress, ImportSource } from "@/lib/import-library";
import { plural } from "@/lib/format";
import { readSpotifyFiles } from "@/lib/spotify-library";
import { useApi } from "@/lib/use-api";
import { Card, Group, Row, settingsStyles as s } from "./parts";

const MISSING_SHOWN = 5;
const number = (n: number) => n.toLocaleString();
const songs = (n: number) => `${number(n)} ${n === 1 ? "song" : "songs"}`;
const NAMES: Record<ImportSource, string> = { apple: "Apple Music", spotify: "Spotify" };
const monthYear = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { month: "long", year: "numeric" });

// Apple Music's Library.xml, or the zips Spotify emails: read here, in the
// browser, so only the songs, playlists and plays in them are sent.
async function read(files: File[]): Promise<ImportLibrary> {
  const xml = files.find((f) => /\.xml$/i.test(f.name));
  if (xml) return readAppleLibrary(await xml.text());
  return readSpotifyFiles(files);
}

// What's about to come in, for the confirmation.
function describe(library: ImportLibrary): string {
  const liked = library.tracks.filter((t) => t.inLibrary).length;
  const parts: string[] = [];
  if (library.source === "apple") {
    parts.push(`${songs(liked)} in your library`, plural(library.playlists.length, "playlist"), `${songs(library.tracks.length)} in all`);
  } else {
    if (liked) parts.push(`${songs(liked)} from Liked Songs`);
    if (library.playlists.length) parts.push(plural(library.playlists.length, "playlist"));
    const listens = library.listens ?? [];
    if (listens.length) parts.push(`${number(listens.length)} plays since ${monthYear(listens[0][1])}`); // oldest first
  }
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${list}. Nothing in your library is removed.`;
}

export function ImportLibrary() {
  const toast = useToast();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data: job, reload } = useApi<ImportProgress | null>("/api/import", version);
  const running = job?.status === "adding" || job?.status === "improving";
  const name = NAMES[job?.source ?? "apple"];

  // Keeps up while it's going: quickly while adding, then at an easy pace.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, job?.status === "adding" ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [running, job?.status, reload]);

  async function choose(picked: File[]) {
    if (!picked.length || reading || running) return;
    setReading(true);
    try {
      // A frame for "Reading…" to show: a big zip takes a moment to open.
      await new Promise((r) => setTimeout(r, 30));
      const library = await read(picked);
      if (!library.tracks.length) throw new Error("There are no songs in that.");
      const go = await confirm({
        title: `Import from ${NAMES[library.source]}?`,
        note: describe(library),
        confirm: "Import",
      });
      if (!go) return;
      await api("/api/import", { method: "POST", json: library });
      setShowAll(false);
      setVersion((v) => v + 1);
    } catch (err) {
      toast(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't read that.", "error");
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  }

  async function stop() {
    const adding = job?.status === "adding";
    const sure = await confirm({
      title: adding ? "Stop importing?" : "Stop matching songs?",
      note: adding ? "Nothing from this import will be added." : "Songs that haven't been matched yet are looked up when you play them.",
      confirm: "Stop",
      danger: adding,
    });
    if (!sure) return;
    try {
      await api("/api/import", { method: "DELETE" });
      reload();
    } catch {
      toast("Couldn't stop it.", "error");
    }
  }

  // Files dragged over the card. Counted, since entering a child leaves the parent.
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const drag = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e) || running) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e) || running) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      if (--depth.current <= 0) {
        depth.current = 0;
        setOver(false);
      }
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e) || running) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      void choose([...e.dataTransfer.files]);
    },
  };

  const stopButton = (
    <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={stop}>
      Stop
    </button>
  );
  const meter = (n: number, of: number) => (
    <div className={s.meter} style={{ margin: "0 18px 16px" }} role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={n}>
      <span style={{ width: `${of ? Math.min(100, (n / of) * 100) : 0}%` }} />
    </div>
  );
  const summary = job?.summary;
  const missing = summary?.missing ?? [];
  const listening = summary?.listens ? `${number(summary.listens)} plays` : summary ? `play counts for ${songs(summary.listening)}` : "";

  return (
    <Group id="import">
      <div className={`${s.dropTarget} ${over ? s.dropOver : ""}`} {...drag}>
        <Card>
          {job?.status === "adding" ? (
            <>
              <Row title={`Importing from ${name}`} note={`${number(job.done)} of ${number(job.total)} songs`}>
                {stopButton}
              </Row>
              {meter(job.done, job.total)}
            </>
          ) : job?.status === "improving" && summary ? (
            <>
              <Row
                title={`Matching songs from ${name}`}
                note={`${number(job.improved)} of ${songs(job.toImprove)} matched for artwork and details. Everything is already playable.`}
              >
                {stopButton}
              </Row>
              {meter(job.improved, job.toImprove)}
            </>
          ) : (
            <>
              {job?.status === "done" && summary && (
                <Row
                  title={`Imported from ${name}`}
                  note={`${new Date(job.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${songs(summary.liked)} liked, ${plural(summary.playlists.length, "playlist")}, ${listening}. Import again to add anything new.`}
                />
              )}
              {job?.status === "failed" && <Row title={`Import from ${name} failed`} note={job.error ?? "Something went wrong. Try again."} />}
              <div className={s.drop}>
                <span className={s.dropIcon}>
                  <Icon name="arrow-down" />
                </span>
                <div className={s.dropText}>
                  <div className={s.rowTitle}>
                    {reading ? (
                      "Reading…"
                    ) : over ? (
                      "Drop to import"
                    ) : (
                      <>
                        <span className={s.forPointer}>Drop your Spotify zip or Library.xml here</span>
                        <span className={s.forTouch}>Choose your Spotify zip or Library.xml</span>
                      </>
                    )}
                  </div>
                  <ul className={s.dropHow}>
                    <li>
                      <strong>Spotify:</strong> request your data at{" "}
                      <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">
                        spotify.com/account/privacy
                      </a>{" "}
                      (include Extended streaming history), then add the zip files as they are.
                    </li>
                    <li>
                      <strong>Apple Music:</strong> in Music or iTunes on a computer, choose File → Library → Export Library.
                    </li>
                  </ul>
                </div>
                <input ref={file} type="file" multiple accept=".zip,.json,.xml,application/zip,application/json,text/xml" hidden onChange={(e) => choose([...(e.target.files ?? [])])} />
                <button type="button" className={`${ui.button} ${ui.buttonSmall} ${job?.status === "done" ? "" : ui.buttonPrimary}`} disabled={reading} onClick={() => file.current?.click()}>
                  <Icon name="plus" /> {reading ? "Reading…" : "Choose files"}
                </button>
              </div>
            </>
          )}
          {job?.status === "done" && missing.length > 0 && (
            <>
              <Row title={`${songs(missing.length)} couldn't be matched`} note="They stay in your library, without artwork." />
              <ul className={s.list}>
                {(showAll ? missing : missing.slice(0, MISSING_SHOWN)).map((m, i) => (
                  <li key={i} className={s.item}>
                    <div className={s.itemText}>
                      <div className={s.itemTitle}>{m.title}</div>
                      <div className={s.itemMeta}>{m.artist}</div>
                    </div>
                  </li>
                ))}
              </ul>
              {missing.length > MISSING_SHOWN && (
                <button type="button" className={s.more} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${number(missing.length)}`}
                </button>
              )}
            </>
          )}
        </Card>
      </div>
    </Group>
  );
}
