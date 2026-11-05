import { describe, expect, test } from "bun:test";
import type { SongResult } from "@/server/library/song-view";
import { findItems } from "./find-songs";

const song = (title: string, artist: string, album?: string) => ({ id: title, title, artists: [{ name: artist }], album: album ? { title: album } : undefined }) as SongResult;
const songs = [
  song("Don't Start Now", "Dua Lipa", "Future Nostalgia"),
  song("CUFF IT", "Beyoncé", "RENAISSANCE"),
  song("Levitating", "Dua Lipa", "Future Nostalgia"),
  song("Rock & Roll", "Led Zeppelin"),
];
const find = (q: string) => findItems(songs, (s) => s, q).map((s) => s.title);

describe("findItems", () => {
  test("nothing typed shows everything", () => {
    expect(find("  ")).toHaveLength(4);
  });

  test("every word has to match somewhere, in any order", () => {
    expect(find("dua lev")).toEqual(["Levitating"]);
    expect(find("nostalgia")).toEqual(["Don't Start Now", "Levitating"]);
    expect(find("lipa zeppelin")).toEqual([]);
  });

  test("case, accents and punctuation don't count", () => {
    expect(find("beyonce")).toEqual(["CUFF IT"]);
    expect(find("dont start")).toEqual(["Don't Start Now"]);
    expect(find("DON'T")).toEqual(["Don't Start Now"]);
    expect(find("rock and roll")).toEqual(["Rock & Roll"]);
  });
});
