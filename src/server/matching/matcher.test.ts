import { describe, expect, test } from "bun:test";
import { compare } from "./matcher";
import { displayTitle, parseTitle, splitArtistNames } from "./normalize";

describe("parseTitle", () => {
  test("pulls featured artists out of the title", () => {
    const p = parseTitle("Baby (feat. Ludacris)");
    expect(p.core).toBe("baby");
    expect(p.featured).toEqual(["Ludacris"]);
  });

  test("detects version tags in brackets and dash suffixes", () => {
    expect([...parseTitle("Baby (Live)").tags]).toEqual(["live"]);
    expect([...parseTitle("Heat Waves - Sped Up").tags]).toEqual(["sped up"]);
  });

  test("ignores remaster labels and video noise", () => {
    expect(parseTitle("Hey Jude - Remastered 2015")).toMatchObject({ core: "hey jude" });
    expect(parseTitle("Hey Jude - Remastered 2015").tags.size).toBe(0);
    expect(parseTitle("Blinding Lights (Official Audio)").core).toBe("blinding lights");
  });

  test("keeps dashes that are part of the title", () => {
    expect(parseTitle("Run - Away").core).toBe("run away");
  });
});

test("displayTitle drops credits and noise but keeps versions", () => {
  expect(displayTitle("Baby (feat. Ludacris)")).toBe("Baby");
  expect(displayTitle("Baby (Live) [Official Video]")).toBe("Baby (Live)");
  expect(displayTitle("Stay ft. Justin Bieber")).toBe("Stay");
});

test("splitArtistNames splits combined credits", () => {
  expect(splitArtistNames(["Justin Bieber, Ludacris"])).toEqual(["Justin Bieber", "Ludacris"]);
  expect(splitArtistNames(["The Kid LAROI & Justin Bieber"])).toEqual([
    "The Kid LAROI",
    "Justin Bieber",
  ]);
  expect(splitArtistNames(["Justin Bieber - Topic"])).toEqual(["Justin Bieber"]);
});

describe("compare", () => {
  test("Deezer and YouTube Music copies of the same song match", () => {
    const r = compare(
      { title: "Baby", artists: ["Justin Bieber"], durationMs: 216_000, isrc: "USUM70919263" },
      { title: "Baby (feat. Ludacris)", artists: ["Justin Bieber"], durationMs: 215_000 },
    );
    expect(r.decision).toBe("match");
  });

  test("equal ISRCs match regardless of text", () => {
    const r = compare(
      { title: "Something", artists: ["A"], isrc: "usum70919263" },
      { title: "Totally different", artists: ["B"], isrc: "USUM70919263" },
    );
    expect(r).toMatchObject({ decision: "match", reason: "isrc" });
  });

  test("live versions never match studio versions", () => {
    const r = compare(
      { title: "Baby", artists: ["Justin Bieber"], durationMs: 216_000 },
      { title: "Baby (Live)", artists: ["Justin Bieber"], durationMs: 216_000 },
    );
    expect(r).toMatchObject({ decision: "different", reason: "version" });
  });

  test("a few seconds of duration disagreement still matches", () => {
    const r = compare(
      { title: "White Keys", artists: ["Dominic Fike"], durationMs: 141_000, isrc: "USQX92506204" },
      { title: "White Keys", artists: ["Dominic Fike"], durationMs: 145_000 },
    );
    expect(r.decision).toBe("match");
  });

  test("larger duration gaps make a match uncertain", () => {
    const r = compare(
      { title: "White Keys", artists: ["Dominic Fike"], durationMs: 141_000 },
      { title: "White Keys", artists: ["Dominic Fike"], durationMs: 148_000 },
    );
    expect(r.decision).toBe("uncertain");
  });

  test("durations more than 8s apart never match", () => {
    const r = compare(
      { title: "Baby", artists: ["Justin Bieber"], durationMs: 216_000 },
      { title: "Baby", artists: ["Justin Bieber"], durationMs: 226_000 },
    );
    expect(r).toMatchObject({ decision: "different", reason: "duration" });
  });

  test("same title by different artists does not match", () => {
    const r = compare(
      { title: "Stay", artists: ["The Kid LAROI", "Justin Bieber"], durationMs: 141_000 },
      { title: "Stay", artists: ["Rihanna", "Mikky Ekko"], durationMs: 140_000 },
    );
    expect(r.decision).not.toBe("match");
  });

  test("a longer title containing the same word does not match", () => {
    const r = compare(
      { title: "Baby", artists: ["Justin Bieber"] },
      { title: "Baby Shark", artists: ["Pinkfong"] },
    );
    expect(r.decision).toBe("different");
  });

  test("bilingual YouTube Music titles match their romanised form", () => {
    const r = compare(
      { title: "Kiminosei", artists: ["Kana Nishino"], durationMs: 138_000, isrc: "JPU902600115" },
      { title: "君のせい - Kiminosei", artists: ["Kana Nishino"], durationMs: 139_000 },
    );
    expect(r.decision).toBe("match");
  });

  test("bilingual live versions still keep their version tag", () => {
    const r = compare(
      { title: "Kiminosei", artists: ["Kana Nishino"], durationMs: 143_000 },
      { title: '君のせい (Live on Special Live "Christmas Magic") - Kiminosei (Live)', artists: ["Kana Nishino"], durationMs: 143_000 },
    );
    expect(r).toMatchObject({ decision: "different", reason: "version" });
  });

  test("a dash in a same-script title is not a translation", () => {
    const r = compare(
      { title: "Run - Away", artists: ["X"], durationMs: 200_000 },
      { title: "Away", artists: ["X"], durationMs: 200_000 },
    );
    expect(r.decision).not.toBe("match");
  });

  test("stylised artist names match their plain spelling", () => {
    const r = compare(
      { title: "We R Who We R", artists: ["Ke$ha"], durationMs: 204_000, isrc: "USRC11000862" },
      { title: "We R Who We R", artists: ["Kesha"], durationMs: 205_000 },
    );
    expect(r.decision).toBe("match");
    expect(compare({ title: "Praise The Lord", artists: ["A$AP Rocky"] }, { title: "Praise The Lord", artists: ["ASAP Rocky"] }).decision).toBe("match");
    expect(compare({ title: "So What", artists: ["P!nk"] }, { title: "So What", artists: ["Pink"] }).decision).toBe("match");
  });

  test("accents and casing are ignored", () => {
    const r = compare(
      { title: "Señorita", artists: ["Shawn Mendes", "Camila Cabello"], durationMs: 191_000 },
      { title: "SENORITA", artists: ["Shawn Mendes & Camila Cabello"], durationMs: 190_000 },
    );
    expect(r.decision).toBe("match");
  });
});
