import type { LyricLine } from "@/server/lyrics/types";

// Turns lyrics into a timeline the immersive view can animate: every line
// gets an end, every line gets word timings (estimated when the source only
// times lines), and long silences become "gap" entries shown as dots.

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export type TimelineEntry =
  | { kind: "line"; start: number; end: number; text: string; romanized?: string; words: TimedWord[]; estimated: boolean }
  | { kind: "gap"; start: number; end: number };

// An intro or break this long gets dots instead of a frozen previous line.
const GAP_MIN_MS = 4500;
// How long singing a line "takes" when we only know when it starts.
const MS_PER_CHAR = 85;
const LINE_PAD_MS = 350;
const LINE_MIN_MS = 700;

export function buildTimeline(lines: LyricLine[], durationMs?: number): TimelineEntry[] {
  const timed = lines.filter((l) => l.startMs !== undefined);
  const out: TimelineEntry[] = [];
  const first = timed.find((l) => l.text);
  if (first && first.startMs! >= GAP_MIN_MS) out.push({ kind: "gap", start: 0, end: first.startMs! });

  timed.forEach((line, i) => {
    const start = line.startMs!;
    const next = timed.slice(i + 1).find((l) => l.startMs! > start)?.startMs ?? line.endMs ?? (durationMs ?? start + 6000);
    if (!line.text) {
      // An empty LRC line marks a break; only show dots if it's long enough.
      if (next - start >= GAP_MIN_MS) out.push({ kind: "gap", start, end: next });
      return;
    }
    const words = line.words?.length ? exactWords(line, next) : estimateWords(line.text, start, next);
    const sungUntil = words.at(-1)!.end;
    out.push({ kind: "line", start, end: next, text: line.text, romanized: line.romanized, words, estimated: !line.words?.length });
    // A long silence after the line is sung (before the next one) is a break too.
    if (next - sungUntil >= GAP_MIN_MS + 1500) out.push({ kind: "gap", start: sungUntil + 600, end: next });
  });
  return out;
}

function exactWords(line: LyricLine, lineEnd: number): TimedWord[] {
  const words = line.words!;
  return words.map((w, i) => ({ text: w.text, start: w.startMs, end: w.endMs ?? words[i + 1]?.startMs ?? lineEnd }));
}

// Splits on spaces for most scripts and per character for CJK (which has no
// spaces), then shares the line's estimated singing time by length.
function estimateWords(text: string, start: number, nextStart: number): TimedWord[] {
  const pieces = splitWords(text);
  const chars = pieces.reduce((n, p) => n + weight(p), 0);
  const singing = Math.min(nextStart - start, Math.max(LINE_MIN_MS, chars * MS_PER_CHAR + LINE_PAD_MS));
  let t = start;
  return pieces.map((p) => {
    const d = (weight(p) / chars) * singing;
    const word = { text: p, start: t, end: t + d };
    t += d;
    return word;
  });
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function splitWords(text: string): string[] {
  const out: string[] = [];
  // Words keep their trailing space so they join back into the line exactly.
  for (const token of text.match(/\S+\s*/g) ?? [text]) {
    if (CJK.test(token)) {
      // Each CJK character is its own "word"; Latin runs inside stay together.
      for (const part of token.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][\s、。！？,.!?]*|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [token]) {
        out.push(part);
      }
    } else {
      out.push(token);
    }
  }
  return out.length ? out : [text];
}

// Punctuation and spaces take no singing time; CJK characters take about two
// Latin letters' worth.
function weight(piece: string): number {
  const letters = piece.replace(/[\s\p{P}]/gu, "");
  if (!letters) return 0.3;
  return [...letters].reduce((n, c) => n + (CJK.test(c) ? 2.2 : 1), 0);
}

// The entry playing at time t: the last one that has started.
export function activeIndex(timeline: TimelineEntry[], t: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
