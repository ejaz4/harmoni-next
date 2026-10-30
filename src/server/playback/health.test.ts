import { describe, expect, test } from "bun:test";
import { isBenched, recordFailure, recordSuccess } from "./health";

describe("health", () => {
  test("one broken song never benches its provider", () => {
    for (let i = 0; i < 5; i++) recordFailure("one", "Unavailable", "song-a");
    expect(isBenched("one")).toBe(false);
  });

  test("failures on three different songs do", () => {
    recordFailure("three", "Unavailable", "song-a");
    recordFailure("three", "Timeout", "song-b");
    expect(isBenched("three")).toBe(false);
    recordFailure("three", "Unavailable", "song-c");
    expect(isBenched("three")).toBe(true);
    recordSuccess("three");
    expect(isBenched("three")).toBe(false);
  });

  test("a missing song isn't the provider's fault", () => {
    for (const id of ["a", "b", "c", "d"]) recordFailure("missing", "NotFound", id);
    expect(isBenched("missing")).toBe(false);
  });
});
