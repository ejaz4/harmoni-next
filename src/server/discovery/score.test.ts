import { describe, expect, test } from "bun:test";
import { classifyListen, currentAffinity, diversify, heardSlices, isDisliked, songAffinity, weightedSample } from "./score";

const DAY = 24 * 60 * 60_000;
const now = Date.UTC(2026, 9, 29);
const stat = (over: Partial<Parameters<typeof songAffinity>[0] & object> = {}) => ({
  listens: 0,
  completes: 0,
  skips: 0,
  earlySkips: 0,
  replays: 0,
  lastAt: new Date(now),
  ...over,
});
const none = { liked: false, playlists: 0 };

describe("songAffinity", () => {
  test("finishing songs counts for more than skipping them", () => {
    const finished = songAffinity(stat({ listens: 5, completes: 5 }), none, now);
    const skipped = songAffinity(stat({ listens: 5, skips: 5, earlySkips: 5 }), none, now);
    expect(finished).toBeGreaterThan(3);
    expect(skipped).toBeLessThan(-2);
  });

  test("replays and library signals add up", () => {
    const base = songAffinity(stat({ listens: 3, completes: 3 }), none, now);
    expect(songAffinity(stat({ listens: 3, completes: 3, replays: 2 }), none, now)).toBeGreaterThan(base);
    expect(songAffinity(stat({ listens: 3, completes: 3 }), { liked: true, playlists: 1 }, now)).toBeCloseTo(base + 3.7);
  });

  test("listening fades with time but never to nothing; likes don't fade", () => {
    const fresh = songAffinity(stat({ listens: 4, completes: 4 }), none, now);
    const old = songAffinity(stat({ listens: 4, completes: 4, lastAt: new Date(now - 365 * DAY) }), none, now);
    expect(old).toBeLessThan(fresh / 2);
    expect(old).toBeGreaterThan(fresh * 0.3);
    expect(songAffinity(undefined, { liked: true, playlists: 0 }, now)).toBe(2.5);
  });

  test("current affinity favours lately", () => {
    expect(currentAffinity(5, new Date(now - 14 * DAY), now)).toBeCloseTo(2.5);
    expect(currentAffinity(-2, new Date(now - 90 * DAY), now)).toBe(-2);
  });
});

describe("isDisliked", () => {
  test("skipped early more than once and never stayed", () => {
    expect(isDisliked(stat({ listens: 2, skips: 2, earlySkips: 2 }), none)).toBe(true);
    expect(isDisliked(stat({ listens: 3, skips: 2, earlySkips: 2, completes: 1 }), none)).toBe(false);
    expect(isDisliked(stat({ listens: 1, skips: 1, earlySkips: 1 }), none)).toBe(false);
  });

  test("never for songs they kept", () => {
    expect(isDisliked(stat({ listens: 4, skips: 4, earlySkips: 4 }), { liked: true, playlists: 0 })).toBe(false);
    expect(isDisliked(stat({ listens: 4, skips: 4, earlySkips: 4 }), { liked: false, playlists: 1 })).toBe(false);
  });
});

describe("classifyListen", () => {
  test("ended, or nearly to the end, is complete", () => {
    expect(classifyListen({ playedMs: 200_000, positionMs: 200_000, durationMs: 200_000, reason: "ended" }).complete).toBe(true);
    expect(classifyListen({ playedMs: 185_000, positionMs: 185_000, durationMs: 200_000, reason: "skip" })).toEqual({ complete: true, skip: false, earlySkip: false });
  });

  test("moving on early is a skip; very early is an early skip", () => {
    expect(classifyListen({ playedMs: 12_000, positionMs: 12_000, durationMs: 200_000, reason: "skip" })).toEqual({ complete: false, skip: true, earlySkip: true });
    expect(classifyListen({ playedMs: 90_000, positionMs: 90_000, durationMs: 200_000, reason: "skip" })).toEqual({ complete: false, skip: true, earlySkip: false });
  });

  test("past 80% or closing the app isn't a skip", () => {
    expect(classifyListen({ playedMs: 170_000, positionMs: 170_000, durationMs: 200_000, reason: "skip" }).skip).toBe(false);
    expect(classifyListen({ playedMs: 10_000, positionMs: 10_000, durationMs: 200_000, reason: "close" }).skip).toBe(false);
  });
});

test("heardSlices unpacks the mask", () => {
  expect(heardSlices(0b101)).toEqual([1, 0, 1, ...Array(17).fill(0)]);
  expect(heardSlices(2 ** 20 - 1).every((x) => x === 1)).toBe(true);
});

describe("diversify", () => {
  const songs = ["a1", "a2", "a3", "b1", "b2", "c1"];
  const artist = (s: string) => s[0];

  test("caps each artist and avoids back-to-back repeats", () => {
    expect(diversify(songs, artist, 10)).toEqual(["a1", "b1", "a2", "b2", "c1"]);
  });

  test("falls back to repeats when nothing else is left", () => {
    expect(diversify(["a1", "a2"], artist, 10)).toEqual(["a1", "a2"]);
  });
});

test("weightedSample picks without replacement and skips zero weights", () => {
  const items = [
    { item: "x", weight: 5 },
    { item: "y", weight: 1 },
    { item: "z", weight: 0 },
  ];
  const picked = weightedSample(items, 3, () => 0);
  expect(picked).toEqual(["x", "y"]);
});
