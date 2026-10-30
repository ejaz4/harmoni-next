import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, normalise } from "./settings";

describe("normalise", () => {
  test("nothing stored is the defaults", () => {
    expect(normalise(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalise("nonsense")).toEqual(DEFAULT_SETTINGS);
  });

  test("keeps valid values and drops the rest", () => {
    const s = normalise({ name: "  Ejaz's music  ", signups: "open", inviteDays: 30, maxAccounts: 12, cacheLimitGb: 25, extra: 1 });
    expect(s.name).toBe("Ejaz's music");
    expect(s.signups).toBe("open");
    expect(s.inviteDays).toBe(30);
    expect(s.maxAccounts).toBe(12);
    expect(s.cacheLimitGb).toBe(25);
    expect("extra" in s).toBe(false);
  });

  test("bad values fall back to what was there", () => {
    const base = normalise({ signups: "closed", inviteDays: 1 });
    const s = normalise({ signups: "everyone", inviteDays: 3, maxAccounts: -1, cacheLimitGb: 7, name: "" }, base);
    expect(s.signups).toBe("closed");
    expect(s.inviteDays).toBe(1);
    expect(s.maxAccounts).toBe(0);
    expect(s.cacheLimitGb).toBe(0);
    expect(s.name).toBe("Harmoni"); // a server always has a name
  });

  test("patches nested settings without losing the others", () => {
    const base = normalise({ features: { lyrics: false }, keys: { lastfm: "abc" } });
    const s = normalise({ features: { link: false }, keys: { spotifyId: "id" } }, base);
    expect(s.features).toEqual({ superProcessing: true, autoplay: true, link: false, lyrics: false });
    expect(s.keys.lastfm).toBe("abc");
    expect(s.keys.spotifyId).toBe("id");
  });

  test("provider lists are prefixes, once each", () => {
    const s = normalise({ disabledProviders: ["deezer", "deezer", "Bad Prefix", 3, "ytm"], songOrder: "ytm" });
    expect(s.disabledProviders).toEqual(["deezer", "ytm"]);
    expect(s.songOrder).toEqual(DEFAULT_SETTINGS.songOrder);
  });
});
