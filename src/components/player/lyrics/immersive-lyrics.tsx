"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LyricLine } from "@/server/lyrics/types";
import { getPlayerAudio } from "../player";
import styles from "../now-playing.module.css";
import { activeIndex, buildTimeline, type TimelineEntry } from "./timeline";

// Where the current line sits, as a fraction of the viewport height.
const ANCHOR = 0.42;
// After scrolling by hand, how long before it follows the song again.
const MANUAL_HOLD_MS = 3000;

// Apple Music–style lyrics: the current line fills word by word, lines
// glide into place with a staggered spring, distant lines soften, breaks
// show breathing dots. Per-frame work writes CSS variables straight to the
// DOM; React only re-renders when the current line changes.
export function ImmersiveLyrics({ lines, durationMs, onSeek }: { lines: LyricLine[]; durationMs?: number; onSeek(ms: number): void }) {
  const timeline = useMemo(() => buildTimeline(lines, durationMs), [lines, durationMs]);
  const [active, setActive] = useState(-1);
  const [layout, setLayout] = useState<{ offsets: number[]; height: number }>({ offsets: [], height: 0 });
  const [manual, setManual] = useState(0);
  const [scrolling, setScrolling] = useState(false);

  const viewport = useRef<HTMLDivElement>(null);
  const entryEls = useRef<(HTMLElement | null)[]>([]);
  const wordEls = useRef<(HTMLSpanElement | null)[][]>([]);
  const activeRef = useRef(-1);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Measure where each entry sits, and again whenever sizes change.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setLayout({ offsets: entryEls.current.map((e) => e?.offsetTop ?? 0), height: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    entryEls.current.forEach((e) => e && observer.observe(e));
    return () => observer.disconnect();
  }, [timeline]);

  // The clock: audio time, smoothed between the element's coarse updates.
  useEffect(() => {
    let frame = 0;
    let lastReported = -1;
    let reportedAt = 0;

    const tick = () => {
      const audio = getPlayerAudio();
      if (audio) {
        let t = audio.currentTime * 1000;
        const now = performance.now();
        if (audio.paused || t !== lastReported) {
          lastReported = t;
          reportedAt = now;
        } else {
          t = lastReported + (now - reportedAt) * audio.playbackRate;
        }

        const idx = activeIndex(timeline, t);
        if (idx !== activeRef.current) {
          // The old line's words go back to their state styling.
          wordEls.current[activeRef.current]?.forEach((w) => w?.style.removeProperty("--p"));
          activeRef.current = idx;
          setActive(idx);
        }
        const entry = timeline[idx];
        if (entry?.kind === "line") {
          const spans = wordEls.current[idx];
          entry.words.forEach((w, i) => {
            const p = Math.min(1, Math.max(0, (t - w.start) / Math.max(1, w.end - w.start)));
            spans?.[i]?.style.setProperty("--p", p.toFixed(3));
          });
        } else if (entry?.kind === "gap") {
          const g = Math.min(1, Math.max(0, (t - entry.start) / Math.max(1, entry.end - entry.start)));
          entryEls.current[idx]?.style.setProperty("--g", g.toFixed(3));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [timeline]);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const scrollBy = (dy: number) => {
    setScrolling(true);
    setManual((m) => {
      const max = (layout.offsets.at(-1) ?? 0) + layout.height;
      return Math.max(-layout.height, Math.min(max, m + dy));
    });
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      setScrolling(false);
      setManual(0);
    }, MANUAL_HOLD_MS);
  };
  const touchY = useRef<number>(undefined);

  const focus = Math.max(0, active);
  const shift = (layout.offsets[focus] ?? 0) - layout.height * ANCHOR + manual;

  return (
    <div
      ref={viewport}
      className={styles.lyrics}
      data-scrolling={scrolling || undefined}
      style={{ "--shift": shift } as React.CSSProperties}
      onWheel={(e) => scrollBy(e.deltaY)}
      onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
      onTouchMove={(e) => {
        const y = e.touches[0].clientY;
        if (touchY.current !== undefined) scrollBy(touchY.current - y);
        touchY.current = y;
      }}
    >
      <div className={styles.lyricsInner}>
        {timeline.map((entry, i) => {
          const d = i - active;
          const state = d < 0 ? "past" : d === 0 ? "active" : "future";
          const style = {
            "--d": Math.min(Math.abs(d), 6),
            // Lines below the current one start moving a beat later each,
            // so the block flows like a wave rather than jumping as one.
            "--delay": `${scrolling || d < 0 ? 0 : Math.min(d, 8) * 45}ms`,
          } as React.CSSProperties;
          return entry.kind === "gap" ? (
            <Gap key={i} ref={(el) => void (entryEls.current[i] = el)} state={state} style={style} />
          ) : (
            <Line
              key={i}
              ref={(el) => void (entryEls.current[i] = el)}
              entry={entry}
              state={state}
              style={style}
              wordRef={(w, j) => {
                (wordEls.current[i] ??= [])[j] = w;
              }}
              onClick={() => onSeek(entry.start)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Line({
  entry,
  state,
  style,
  wordRef,
  onClick,
  ref,
}: {
  entry: Extract<TimelineEntry, { kind: "line" }>;
  state: string;
  style: React.CSSProperties;
  wordRef(el: HTMLSpanElement | null, index: number): void;
  onClick(): void;
  ref: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={ref} type="button" className={styles.line} data-state={state} style={style} onClick={onClick}>
      <span className={styles.lineText}>
        {entry.words.map((w, j) => (
          <span key={j} ref={(el) => wordRef(el, j)} className={styles.word}>
            {w.text}
          </span>
        ))}
      </span>
      {entry.romanized && <span className={styles.roman}>{entry.romanized}</span>}
    </button>
  );
}

function Gap({ state, style, ref }: { state: string; style: React.CSSProperties; ref: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={styles.gap} data-state={state} style={style} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className={styles.dot} style={{ "--i": i } as React.CSSProperties} />
      ))}
    </div>
  );
}

// Lyrics without timing: a calm, readable column you scroll yourself.
export function PlainLyrics({ lines }: { lines: LyricLine[] }) {
  return (
    <div className={styles.plain}>
      {lines.map((l, i) => (
        <p key={i} className={styles.plainLine}>
          {l.text || " "}
          {l.romanized && <span className={styles.roman}>{l.romanized}</span>}
        </p>
      ))}
      <p className={styles.plainNote}>These lyrics aren&apos;t synced to the music.</p>
    </div>
  );
}
