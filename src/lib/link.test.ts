import { afterEach, describe, expect, test } from "bun:test";
import { describeDevice, positionAt } from "./link";

describe("positionAt", () => {
  test("a playing song moves on with the clock", () => {
    expect(positionAt({ positionMs: 10_000, playing: true, at: 1000, durationMs: 200_000 }, 4000)).toBe(13_000);
  });
  test("a paused one stays put", () => {
    expect(positionAt({ positionMs: 10_000, playing: false, at: 1000, durationMs: 200_000 }, 9000)).toBe(10_000);
  });
  test("never past the end, never before where it was", () => {
    expect(positionAt({ positionMs: 199_000, playing: true, at: 0, durationMs: 200_000 }, 60_000)).toBe(200_000);
    expect(positionAt({ positionMs: 5000, playing: true, at: 9000, durationMs: null }, 1000)).toBe(5000);
  });
});

describe("describeDevice", () => {
  const real = globalThis.navigator;
  const as = (userAgent: string, maxTouchPoints = 0) => Object.defineProperty(globalThis, "navigator", { value: { userAgent, maxTouchPoints }, configurable: true });
  afterEach(() => Object.defineProperty(globalThis, "navigator", { value: real, configurable: true }));

  test("phones and tablets by what they are", () => {
    as("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");
    expect(describeDevice()).toEqual({ name: "iPhone", kind: "phone" });
    as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5);
    expect(describeDevice()).toEqual({ name: "iPad", kind: "tablet" });
    as("Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36");
    expect(describeDevice()).toEqual({ name: "Android phone", kind: "phone" });
  });

  test("computers by browser and system", () => {
    as("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15");
    expect(describeDevice().name).toBe("Safari on Mac");
    as("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0");
    expect(describeDevice().name).toBe("Edge on Windows");
    as("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0");
    expect(describeDevice().name).toBe("Firefox on Linux");
  });
});
