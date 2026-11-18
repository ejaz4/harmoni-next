import { describe, expect, test } from "bun:test";
import { closeness, dailySpiceLabel, dayPart, PARTS, validTimeZone } from "./day-part";

const at = (iso: string) => new Date(iso);

describe("dayPart", () => {
  test("names the part of the day in their own time zone", () => {
    // 08:30 UTC is 08:30 in London in November, 17:30 in Seoul.
    expect(dayPart(at("2026-11-18T08:30:00Z"), "Europe/London")).toMatchObject({ key: "morning", label: "Morning", slot: "2026-11-18 morning" });
    expect(dayPart(at("2026-11-18T08:30:00Z"), "Asia/Seoul")).toMatchObject({ key: "evening", label: "Evening" });
  });

  test("late night belongs to the evening before it", () => {
    // 01:00 Thursday is still Wednesday's late night.
    expect(dayPart(at("2026-11-19T01:00:00Z"), "UTC")).toMatchObject({ key: "late-night", label: "Late Night", slot: "2026-11-18 late-night" });
  });

  test("Friday and Saturday nights say so", () => {
    expect(dayPart(at("2026-11-20T19:00:00Z"), "UTC").label).toBe("Friday Evening");
    // 02:00 Saturday is Friday night.
    expect(dayPart(at("2026-11-21T02:00:00Z"), "UTC").label).toBe("Friday Night");
    expect(dayPart(at("2026-11-22T23:00:00Z"), "UTC").label).toBe("Late Night"); // Sunday
  });

  test("knows when it ends", () => {
    expect(dayPart(at("2026-11-18T10:15:00Z"), "UTC").endsAt.toISOString()).toBe("2026-11-18T12:00:00.000Z");
    expect(dayPart(at("2026-11-18T23:00:00Z"), "UTC").endsAt.toISOString()).toBe("2026-11-19T04:00:00.000Z");
    expect(dayPart(at("2026-11-19T02:00:00Z"), "UTC").endsAt.toISOString()).toBe("2026-11-19T04:00:00.000Z");
  });
});

test("listens near a part of the day count a little, far ones not at all", () => {
  const morning = PARTS.find((p) => p.key === "morning")!;
  expect(closeness(9, morning)).toBe(1);
  expect(closeness(7, morning)).toBeGreaterThan(0);
  expect(closeness(13.5, morning)).toBeGreaterThan(0);
  expect(closeness(20, morning)).toBe(0);
  const late = PARTS.find((p) => p.key === "late-night")!;
  expect(closeness(1, late)).toBe(1);
  expect(closeness(23, late)).toBe(1);
  expect(closeness(21, late)).toBeGreaterThan(0);
  expect(closeness(5, late)).toBeGreaterThan(0);
  expect(closeness(12, late)).toBe(0);
});

test("labels and time zones", () => {
  expect(dailySpiceLabel("Ejaz Ali")).toBe("Ejaz's Spice");
  expect(validTimeZone("Europe/London")).toBe(true);
  expect(validTimeZone("Mars/Olympus")).toBe(false);
  expect(validTimeZone(42)).toBe(false);
});
