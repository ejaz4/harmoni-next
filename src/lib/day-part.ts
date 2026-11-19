// Parts of the day, in someone's own time zone. The Daily Spice changes
// with them; shared by the server (which makes it) and the sidebar (which
// shows which part it's in).

const DAY = 24 * 60 * 60_000;
const NEARBY_WEIGHT = 0.35; // listens within two hours of the part of the day count a little

export interface Part {
  key: string;
  label: string;
  start: number; // local hour it begins
  end: number; // local hour it ends; past 24 for late night
}

export const PARTS: Part[] = [
  { key: "early-morning", label: "Early Morning", start: 4, end: 8 },
  { key: "morning", label: "Morning", start: 8, end: 12 },
  { key: "afternoon", label: "Afternoon", start: 12, end: 17 },
  { key: "evening", label: "Evening", start: 17, end: 22 },
  { key: "late-night", label: "Late Night", start: 22, end: 28 },
];

export interface DayPart {
  key: string; // "morning"
  label: string; // "Morning", or "Friday Night" at the weekend
  slot: string; // which one, on which day: "2026-11-18 morning"
  endsAt: Date;
}

export interface Local {
  date: string; // YYYY-MM-DD
  hour: number; // with minutes as a fraction
  weekday: string;
}

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function local(at: Date, tz: string): Local {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) + Number(p.minute) / 60, weekday: p.weekday };
}

// Late night belongs to the evening before it: 1am Saturday is still Friday night.
const partOf = (hour: number) => PARTS.find((p) => (hour < 4 ? hour + 24 : hour) >= p.start && (hour < 4 ? hour + 24 : hour) < p.end)!;

export function dayPart(at: Date, tz: string): DayPart {
  const now = local(at, tz);
  const part = partOf(now.hour);
  const hour = now.hour < 4 ? now.hour + 24 : now.hour;
  const before = now.hour < 4 ? local(new Date(at.getTime() - DAY), tz) : now;
  const weekend = (before.weekday === "Friday" || before.weekday === "Saturday") && (part.key === "evening" || part.key === "late-night");
  return {
    key: part.key,
    label: weekend ? `${before.weekday} ${part.key === "evening" ? "Evening" : "Night"}` : part.label,
    slot: `${before.date} ${part.key}`,
    // On the minute: `hour` only carries minutes, so the seconds would ride along.
    endsAt: new Date(Math.round((at.getTime() + (part.end - hour) * 60 * 60_000) / 60_000) * 60_000),
  };
}

// How much a listen at this hour belongs to the part of the day: fully
// inside it, a little within two hours of it.
export function closeness(hour: number, part: Part): number {
  const h = hour < 4 ? hour + 24 : hour;
  if (h >= part.start && h < part.end) return 1;
  const gap = Math.min(...[h, h + 24, h - 24].map((x) => (x < part.start ? part.start - x : x - part.end)).filter((d) => d >= 0));
  return gap <= 2 ? NEARBY_WEIGHT : 0;
}


export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// What the sidebar calls someone's Daily Spice; the page has the full name.
export const dailySpiceLabel = (name: string) => `${firstName(name)}'s Spice`;

// The device's own time zone, for the server.
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
