import { describe, expect, test } from "bun:test";
import { activeIndex, buildTimeline } from "./timeline";

describe("buildTimeline", () => {
  test("adds an intro gap and estimates word timing within the line", () => {
    const tl = buildTimeline([
      { startMs: 11_850, text: "A'ight, pitch black Chevy antique" },
      { startMs: 15_100, text: "I ain't have nothing" },
    ]);
    expect(tl[0]).toMatchObject({ kind: "gap", start: 0, end: 11_850 });
    const line = tl[1];
    if (line.kind !== "line") throw new Error("expected a line");
    expect(line.words.map((w) => w.text).join("")).toBe("A'ight, pitch black Chevy antique");
    expect(line.words[0].start).toBe(11_850);
    // Words run in order and finish before the next line starts.
    line.words.forEach((w, i) => i && expect(w.start).toBeCloseTo(line.words[i - 1].end));
    expect(line.words.at(-1)!.end).toBeLessThanOrEqual(15_100);
  });

  test("splits Japanese per character but keeps Latin words whole", () => {
    const tl = buildTimeline([{ startMs: 0, text: "ごめんって right now そんな" }, { startMs: 5000, text: "x" }]);
    const line = tl[0];
    if (line.kind !== "line") throw new Error("expected a line");
    expect(line.words.map((w) => w.text)).toEqual(["ご", "め", "ん", "っ", "て ", "right ", "now ", "そ", "ん", "な"]);
  });

  test("uses exact word timing when the source has it", () => {
    const tl = buildTimeline([
      { startMs: 1000, text: "Hello world", words: [{ startMs: 1000, text: "Hello " }, { startMs: 1400, text: "world" }] },
      { startMs: 3000, text: "next" },
    ]);
    const line = tl[0];
    if (line.kind !== "line") throw new Error("expected a line");
    expect(line.estimated).toBe(false);
    expect(line.words).toEqual([
      { text: "Hello ", start: 1000, end: 1400 },
      { text: "world", start: 1400, end: 3000 },
    ]);
  });

  test("long empty lines become gaps, short ones vanish", () => {
    const tl = buildTimeline([
      { startMs: 0, text: "a" },
      { startMs: 2000, text: "" },
      { startMs: 3000, text: "b" },
      { startMs: 4000, text: "" },
      { startMs: 20_000, text: "c" },
    ]);
    expect(tl.map((e) => e.kind)).toEqual(["line", "line", "gap", "line"]);
  });
});

test("activeIndex finds the last entry that has started", () => {
  const tl = buildTimeline([
    { startMs: 0, text: "a" },
    { startMs: 2000, text: "b" },
    { startMs: 4000, text: "c" },
  ]);
  expect(activeIndex(tl, -1)).toBe(-1);
  expect(activeIndex(tl, 0)).toBe(0);
  expect(activeIndex(tl, 2500)).toBe(1);
  expect(activeIndex(tl, 99_999)).toBe(2);
});
