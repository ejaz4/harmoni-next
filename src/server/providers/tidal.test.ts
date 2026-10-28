import { expect, test } from "bun:test";
import { mapTracks, parseIsoDuration } from "./tidal";

test("parseIsoDuration handles TIDAL's durations", () => {
  expect(parseIsoDuration("PT3M25S")).toBe(205_000);
  expect(parseIsoDuration("PT2M58S")).toBe(178_000);
  expect(parseIsoDuration("PT1H2M3S")).toBe(3_723_000);
  expect(parseIsoDuration("PT45S")).toBe(45_000);
  expect(parseIsoDuration("nonsense")).toBeUndefined();
});

// Shape from TIDAL's OpenAPI spec: tracks in `data`, artists/albums in `included`.
test("mapTracks resolves artists and albums and keeps versions", () => {
  const candidates = mapTracks({
    data: [
      {
        id: "111",
        type: "tracks",
        attributes: { title: "We R Who We R", version: "", duration: "PT3M24S", isrc: "USRC11000862", explicit: false },
        relationships: {
          artists: { data: [{ id: "9", type: "artists" }] },
          albums: { data: [{ id: "50", type: "albums" }] },
        },
      },
      {
        id: "222",
        type: "tracks",
        attributes: { title: "Kiminosei", version: "Live Version", duration: "PT4M30S", isrc: "JPU902001815", explicit: true },
        relationships: { artists: { data: [{ id: "10", type: "artists" }] }, albums: { data: [] } },
      },
    ],
    included: [
      { id: "9", type: "artists", attributes: { name: "Kesha" } },
      { id: "10", type: "artists", attributes: { name: "Kana Nishino" } },
      { id: "50", type: "albums", attributes: { title: "Cannibal (Expanded Edition)" } },
    ],
  });

  expect(candidates).toEqual([
    {
      source: "tidal:111",
      title: "We R Who We R",
      artists: [{ name: "Kesha", source: "tidal:9" }],
      album: { name: "Cannibal (Expanded Edition)", source: "tidal:50" },
      durationMs: 204_000,
      isrc: "USRC11000862",
      explicit: false,
    },
    {
      source: "tidal:222",
      title: "Kiminosei (Live Version)",
      artists: [{ name: "Kana Nishino", source: "tidal:10" }],
      album: undefined,
      durationMs: 270_000,
      isrc: "JPU902001815",
      explicit: true,
    },
  ]);
});
