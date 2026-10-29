import { expect, test } from "bun:test";
import { namedFor } from "./deezer";

test("namedFor matches whole words, and one-word searches run together", () => {
  expect(namedFor("Top K-Pop", "k-pop")).toBe(true);
  expect(namedFor("Top K-Pop", "kpop")).toBe(true);
  expect(namedFor("90s Rock", "90s rock")).toBe(true);
  expect(namedFor("100% Taylor Swift", "taylor swift")).toBe(true);
  expect(namedFor("Crusade Anthems", "sad")).toBe(false);
  expect(namedFor("Popcorn", "pop")).toBe(false);
});
