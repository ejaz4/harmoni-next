import type { LyricLine, LyricWord, Lyrics } from "./types";

const LINE_TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const META = /^\[(ar|ti|al|au|by|length|re|ve|offset):(.*)\]$/i;

function toMs(min: string, sec: string, frac = "0"): number {
  // ".5" is half a second, ".05" five hundredths, ".005" five thousandths.
  const fracMs = Number(frac.padEnd(3, "0").slice(0, 3));
  return Number(min) * 60_000 + Number(sec) * 1000 + fracMs;
}

// Parses LRC, including the "enhanced" word-timing form:
//   [00:12.34] <00:12.34>Hello <00:12.80>world
// A line with several timestamps ([00:10.00][01:20.00] Chorus) appears once per timestamp.
export function parseLrc(text: string): Lyrics {
  let offset = 0;
  const lines: LyricLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    const meta = trimmed.match(META);
    if (meta) {
      if (meta[1].toLowerCase() === "offset") offset = Number(meta[2]) || 0;
      continue;
    }
    const stamps = [...trimmed.matchAll(LINE_TIME)];
    if (!stamps.length) continue;
    const body = trimmed.replace(LINE_TIME, "").trim();
    const words = parseWords(body);
    const plain = words ? words.map((w) => w.text).join("").trim() : body;
    for (const [, m, s, f] of stamps) {
      lines.push({ startMs: toMs(m, s, f), text: plain, ...(words && { words }) });
    }
  }

  // LRC offset is in ms; positive means lyrics should appear earlier.
  for (const line of lines) {
    line.startMs = Math.max(0, line.startMs! - offset);
    line.words?.forEach((w) => (w.startMs = Math.max(0, w.startMs - offset)));
  }
  lines.sort((a, b) => a.startMs! - b.startMs!);
  lines.forEach((line, i) => {
    const next = lines.at(i + 1);
    if (next) line.endMs = next.startMs;
    line.words?.forEach((w, j) => (w.endMs = line.words!.at(j + 1)?.startMs ?? line.endMs));
  });

  const trimmedLines = trimEmpty(lines);
  return { sync: trimmedLines.some((l) => l.words?.length) ? "word" : "line", lines: trimmedLines };
}

function parseWords(body: string): LyricWord[] | undefined {
  const stamps = [...body.matchAll(WORD_TIME)];
  if (!stamps.length) return undefined;
  return stamps
    .map((m, i) => {
      const start = m.index! + m[0].length;
      const end = stamps.at(i + 1)?.index ?? body.length;
      return { startMs: toMs(m[1], m[2], m[3]), text: body.slice(start, end) };
    })
    .filter((w) => w.text.length > 0);
}

export function parsePlain(text: string): Lyrics {
  const lines = text.split(/\r?\n/).map((l) => ({ text: l.trim() }));
  return { sync: "none", lines: trimEmpty(lines) };
}

// Drops leading/trailing blank lines but keeps gaps in the middle.
function trimEmpty(lines: LyricLine[]): LyricLine[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].text) start++;
  while (end > start && !lines[end - 1].text) end--;
  return lines.slice(start, end);
}
