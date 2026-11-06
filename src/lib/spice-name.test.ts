import { describe, expect, test } from "bun:test";
import { spiceName } from "./spice-name";

const by = (...artists: string[]) => ({ artists: artists.map((name, i) => ({ name, role: i ? "featured" : "primary" })) });

describe("spiceName", () => {
  test("named after the seeds' artists, the most picked first", () => {
    expect(spiceName([by("Dua Lipa")])).toBe("Dua Lipa");
    expect(spiceName([by("Dua Lipa"), by("Beyoncé"), by("Beyoncé")])).toBe("Beyoncé & Dua Lipa");
    expect(spiceName([by("NewJeans"), by("LE SSERAFIM"), by("IVE")])).toBe("NewJeans, LE SSERAFIM & IVE");
    expect(spiceName([by("A"), by("B"), by("C"), by("D")])).toBe("A, B & more");
  });

  test("featured artists don't count, and the same artist counts once", () => {
    expect(spiceName([by("Calvin Harris", "Dua Lipa"), by("calvin harris")])).toBe("Calvin Harris");
  });

  test("shortens long names, and copes with no artists", () => {
    const long = "An Artist With A Remarkably Long Name, Truly";
    expect(spiceName([by(long), by("Someone Else Entirely")])).toBe(`${long} & more`);
    expect(spiceName([])).toBe("My Spice");
  });
});
