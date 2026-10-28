import { describe, expect, test } from "bun:test";
import { nameConfidence, pickTopArtist } from "./search-rank";

const taylor = { id: "a1", name: "Taylor Swift", songs: 12 };
const tinie = { id: "a2", name: "Tinie Tempah", songs: 2 };
const patientZero = { title: "Patient Zero", artists: [{ name: "Taylor Swift" }] };
const blankSpace = { title: "Blank Space", artists: [{ name: "Taylor Swift" }] };

describe("pickTopArtist", () => {
  test("the artist's name picks the artist over their song", () => {
    expect(pickTopArtist("taylor swift", [taylor], patientZero)).toBe(taylor);
  });

  test.each(["taylr swift", "tylor swfit", "TAYLOR  SWIFT", "taylor sw", "taylorswift"])("forgives %p", (q) => {
    expect(pickTopArtist(q, [tinie, taylor], patientZero)).toBe(taylor);
  });

  test("a song title picks the song", () => {
    expect(pickTopArtist("blank space", [taylor], blankSpace)).toBeUndefined();
    expect(pickTopArtist("taylor swift blank space", [taylor], blankSpace)).toBeUndefined();
  });

  test("an unrelated query picks no artist", () => {
    expect(pickTopArtist("midnight rain", [taylor, tinie], patientZero)).toBeUndefined();
  });

  test("normalises accents, stylised letters and a leading 'the'", () => {
    expect(nameConfidence("beyonce", "Beyoncé")).toBe(1);
    expect(nameConfidence("kesha", "Ke$ha")).toBe(1);
    expect(nameConfidence("weeknd", "The Weeknd")).toBe(1);
  });
});
