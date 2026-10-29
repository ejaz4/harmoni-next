import { describe, expect, test } from "bun:test";
import type { SongResult } from "@/server/library/song-view";
import { sortItems } from "./sort-songs";

const song = (title: string, artist: string) => ({ id: title, title, artists: [{ name: artist }] }) as SongResult;
// In the order they were added.
const songs = [song("Midnight City", "M83"), song("dreams", "Fleetwood Mac"), song("Track 10", "Air"), song("Track 9", "Air")];
const titles = (list: SongResult[]) => list.map((s) => s.title);
const by = (list: SongResult[], field: "order" | "title" | "artist", descending = false) => titles(sortItems(list, (s) => s, { field, descending }));

describe("sortItems", () => {
  test("date added keeps the list's order, or flips it", () => {
    expect(by(songs, "order")).toEqual(["Midnight City", "dreams", "Track 10", "Track 9"]);
    expect(by(songs, "order", true)).toEqual(["Track 9", "Track 10", "dreams", "Midnight City"]);
  });

  test("titles sort ignoring case, with numbers in number order", () => {
    expect(by(songs, "title")).toEqual(["dreams", "Midnight City", "Track 9", "Track 10"]);
    expect(by(songs, "title", true)).toEqual(["Track 10", "Track 9", "Midnight City", "dreams"]);
  });

  test("artists sort by the lead artist, then title", () => {
    expect(by(songs, "artist")).toEqual(["Track 9", "Track 10", "dreams", "Midnight City"]);
    expect(by(songs, "artist", true)).toEqual(["Midnight City", "dreams", "Track 10", "Track 9"]);
  });

  test("the same song twice stays in the order it was added", () => {
    const twice = [song("A", "X"), { ...song("A", "X"), id: "A2" }];
    expect(sortItems(twice, (s) => s, { field: "title", descending: true }).map((s) => s.id)).toEqual(["A", "A2"]);
  });

  test("doesn't change the list it was given", () => {
    const copy = [...songs];
    sortItems(songs, (s) => s, { field: "title", descending: false });
    expect(songs).toEqual(copy);
  });
});
