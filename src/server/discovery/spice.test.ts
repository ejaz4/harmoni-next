import { expect, test } from "bun:test";
import { prettyName } from "./spice";

test("prettyName takes the collection's spelling", () => {
  expect(prettyName("k-pop", "Top K-Pop")).toBe("K-Pop");
  expect(prettyName("kpop", "Top K-Pop")).toBe("K-Pop");
  expect(prettyName("taylor swift", "100% Taylor Swift")).toBe("Taylor Swift");
  expect(prettyName("90s rock", "90s Rock")).toBe("90s Rock");
});

test("prettyName title-cases when the collection is lowercase too", () => {
  expect(prettyName("lofi", "chill lofi")).toBe("Lofi");
  expect(prettyName("sad", "super sad")).toBe("Sad");
});
