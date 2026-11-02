"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { useConfirm } from "@/components/providers/prompt";
import { useToast } from "@/components/providers/toast";
import { ui } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { readAppleLibrary, type ImportProgress } from "@/lib/apple-library";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { Card, Group, Row, settingsStyles as s } from "./parts";

const MISSING_SHOWN = 5;
const number = (n: number) => n.toLocaleString();
const songs = (n: number) => `${number(n)} ${n === 1 ? "song" : "songs"}`;

// Bringing in an Apple Music library. The file is read here, in the
// browser; only the songs and playlists in it are sent.
export function ImportLibrary() {
  const toast = useToast();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [reading, setReading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data: job, reload } = useApi<ImportProgress | null>("/api/import", version);
  const running = job?.status === "adding" || job?.status === "improving";

  // Keeps up while it's going: quickly while adding, then at an easy pace.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, job?.status === "adding" ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [running, job?.status, reload]);

  async function choose(picked: File | undefined) {
    if (!picked) return;
    setReading(true);
    try {
      const library = readAppleLibrary(await picked.text());
      const inLibrary = library.tracks.filter((t) => t.inLibrary).length;
      const go = await confirm({
        title: "Bring in your Apple Music library?",
        note: `${songs(inLibrary)} in your library, ${plural(library.playlists.length, "playlist")} and ${songs(library.tracks.length)} in all. They're added to what you have here; nothing is removed.`,
        confirm: "Bring it in",
      });
      if (!go) return;
      await api("/api/import", { method: "POST", json: library });
      setShowAll(false);
      setVersion((v) => v + 1);
    } catch (err) {
      toast(err instanceof ApiError || err instanceof Error ? err.message : "Couldn't read that file.", "error");
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  }

  async function stop() {
    const adding = job?.status === "adding";
    const sure = await confirm({
      title: adding ? "Stop bringing it in?" : "Stop looking for songs?",
      note: adding
        ? "Nothing from this library is added. You can start again any time."
        : "Your library stays as it is. Songs not looked up yet are still found the first time you play them.",
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

  const chooser = (
    <>
      <input ref={file} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => choose(e.target.files?.[0])} />
      <button type="button" className={`${ui.button} ${ui.buttonSmall} ${job?.status === "done" ? "" : ui.buttonPrimary}`} disabled={reading} onClick={() => file.current?.click()}>
        <Icon name="plus" /> {reading ? "Reading…" : job?.status === "done" ? "Again" : "Choose file"}
      </button>
    </>
  );
  const stopButton = (
    <button type="button" className={`${ui.button} ${ui.buttonSmall}`} onClick={stop}>
      Stop
    </button>
  );
  const meter = (n: number, of: number) => (
    <div className={s.meter} style={{ margin: "0 20px 16px" }} role="progressbar" aria-valuemin={0} aria-valuemax={of} aria-valuenow={n}>
      <span style={{ width: `${of ? Math.min(100, (n / of) * 100) : 0}%` }} />
    </div>
  );
  const summary = job?.summary;
  const missing = summary?.missing ?? [];

  return (
    <Group
      id="import"
      title="Bring your music"
      note="Your Apple Music library, playlists and play counts. In Music or iTunes on a computer, choose File → Library → Export Library…, then pick the file here."
    >
      <Card>
        {job?.status === "adding" ? (
          <>
            <Row title="Bringing in your library" note={`${number(job.done)} of ${number(job.total)} songs`}>
              {stopButton}
            </Row>
            {meter(job.done, job.total)}
          </>
        ) : job?.status === "improving" && summary ? (
          <>
            <Row
              title="Your library is in"
              note={`${songs(summary.liked)} added to your likes, ${plural(summary.playlists.length, "playlist")}. Now looking up the ${songs(job.toImprove)} new to Harmoni for their artwork and details: ${number(job.improved)} so far. They all play in the meantime.`}
            >
              {stopButton}
            </Row>
            {meter(job.improved, job.toImprove)}
          </>
        ) : (
          <Row
            title="Apple Music"
            note={
              job?.status === "done" && summary
                ? `Brought in ${new Date(job.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}: ${songs(summary.liked)} added to your likes, ${plural(summary.playlists.length, "playlist")}, and play counts for ${songs(summary.listening)}. Bringing it in again adds anything new.`
                : job?.status === "failed"
                  ? (job.error ?? "That didn't work. Try again?")
                  : "Nothing here yet."
            }
          >
            {chooser}
          </Row>
        )}
        {job?.status === "done" && missing.length > 0 && (
          <>
            <Row
              title={`${songs(missing.length)} not found anywhere`}
              note="None of the music services had these, so they have no artwork. They stay in your library, and playing one still looks for it."
            />
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
    </Group>
  );
}
