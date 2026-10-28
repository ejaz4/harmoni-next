import { describe, expect, test } from "bun:test";
import { parseLrc, parsePlain } from "./lrc";
import { detectLanguage } from "./romanize";

describe("parseLrc", () => {
  test("parses line timing and sets end times", () => {
    const l = parseLrc("[ar:Dominic Fike]\n[00:11.85] A'ight, pitch black Chevy\n[00:15.10] I ain't have nothing\n[00:18.5]\n");
    expect(l.sync).toBe("line");
    expect(l.lines).toEqual([
      { startMs: 11_850, endMs: 15_100, text: "A'ight, pitch black Chevy" },
      { startMs: 15_100, text: "I ain't have nothing", endMs: 18_500 },
    ]);
  });

  test("repeats lines with several timestamps, in time order", () => {
    const l = parseLrc("[00:10.00][00:30.00] Chorus\n[00:20.00] Verse");
    expect(l.lines.map((x) => [x.startMs, x.text])).toEqual([
      [10_000, "Chorus"],
      [20_000, "Verse"],
      [30_000, "Chorus"],
    ]);
  });

  test("parses enhanced word timing", () => {
    const l = parseLrc("[00:12.34] <00:12.34>Hello <00:12.80>world\n[00:14.00] next");
    expect(l.sync).toBe("word");
    expect(l.lines[0]).toEqual({
      startMs: 12_340,
      endMs: 14_000,
      text: "Hello world",
      words: [
        { startMs: 12_340, endMs: 12_800, text: "Hello " },
        { startMs: 12_800, endMs: 14_000, text: "world" },
      ],
    });
  });

  test("applies the offset tag", () => {
    expect(parseLrc("[offset:500]\n[00:10.00] a").lines[0].startMs).toBe(9_500);
  });
});

test("parsePlain trims surrounding blank lines but keeps gaps", () => {
  expect(parsePlain("\n\nOne more time\n\nOne more time\n\n").lines.map((l) => l.text)).toEqual([
    "One more time",
    "",
    "One more time",
  ]);
});

test("detectLanguage judges the whole song", () => {
  expect(detectLanguage([{ text: "君のせい" }, { text: "何で" }])).toBe("ja");
  expect(detectLanguage([{ text: "我爱你" }])).toBe("zh");
  expect(detectLanguage([{ text: "사랑해요" }])).toBe("ko");
  expect(detectLanguage([{ text: "Hello" }])).toBeUndefined();
});
