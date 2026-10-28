"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { LyricsResponse } from "@/server/lyrics/service";

// Bare test view: follows the audio element, highlights the current line
// (and word, when the lyrics have word timing), click a line to seek.
// Render with key={songId} so its state resets per song.
export function LyricsPanel({ songId, audioRef }: { songId: string; audioRef: RefObject<HTMLAudioElement | null> }) {
  const [lyrics, setLyrics] = useState<LyricsResponse>();
  const [error, setError] = useState<string>();
  const [timeMs, setTimeMs] = useState(0);
  const [showRomanized, setShowRomanized] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/lyrics/${songId}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setLyrics(body);
      })
      .catch((err) => !controller.signal.aborted && setError(String(err)));
    return () => controller.abort();
  }, [songId]);

  // Poll the playhead every frame while playing; timeupdate only fires ~4 times a second.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let frame = 0;
    const tick = () => {
      setTimeMs(audio.currentTime * 1000);
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const sync = () => setTimeMs(audio.currentTime * 1000);
    const stop = () => {
      cancelAnimationFrame(frame);
      sync();
    };
    audio.addEventListener("playing", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("seeked", sync);
    if (!audio.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener("playing", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("seeked", sync);
    };
  }, [audioRef, songId]);

  const lines = lyrics?.lines ?? [];
  const synced = lyrics?.sync === "line" || lyrics?.sync === "word";
  const active = synced ? lines.findLastIndex((l) => l.startMs !== undefined && l.startMs <= timeMs) : -1;

  useEffect(() => {
    const box = container.current;
    const line = activeLine.current;
    if (box && line) box.scrollTo({ top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
  }, [active]);

  if (error) return <p style={{ color: "crimson" }}>Lyrics: {error}</p>;
  if (!lyrics) return <p>Loading lyrics…</p>;
  if (!lyrics.found) return <p>No lyrics found.</p>;
  if (lyrics.instrumental) return <p>Instrumental.</p>;

  return (
    <div>
      <small>
        Lyrics from {lyrics.provider} · {synced ? `${lyrics.sync}-synced` : "not synced"}
        {lyrics.language && (
          <>
            {" "}
            ·{" "}
            <label>
              <input type="checkbox" checked={showRomanized} onChange={(e) => setShowRomanized(e.target.checked)} /> romanised
            </label>
          </>
        )}
      </small>
      <div ref={container} style={{ position: "relative", height: 320, overflowY: "auto", border: "1px solid #ccc", padding: "0 8px" }}>
        {lines.map((line, i) => {
          const isActive = i === active;
          return (
            <p
              key={i}
              ref={isActive ? activeLine : undefined}
              onClick={() => {
                if (line.startMs !== undefined && audioRef.current) audioRef.current.currentTime = line.startMs / 1000;
              }}
              style={{
                margin: "6px 0",
                cursor: line.startMs !== undefined ? "pointer" : undefined,
                fontWeight: isActive ? "bold" : undefined,
                opacity: synced && i < active ? 0.5 : 1,
                minHeight: "1em",
              }}
            >
              {isActive && line.words
                ? line.words.map((w, j) => (
                    <span key={j} style={{ opacity: w.startMs <= timeMs ? 1 : 0.4 }}>
                      {w.text}
                    </span>
                  ))
                : line.text || (synced ? "♪" : "")}
              {showRomanized && line.romanized && (
                <>
                  <br />
                  <small style={{ fontWeight: "normal", color: "#666" }}>{line.romanized}</small>
                </>
              )}
            </p>
          );
        })}
      </div>
    </div>
  );
}
