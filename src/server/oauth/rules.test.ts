import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { grantScope, redirectMatches, redirectProblem, validChallenge, verifierMatches, withParams } from "./rules";

describe("redirectProblem", () => {
  test("takes an app's own scheme, https, and loopback http", () => {
    for (const ok of ["com.example.harmoni:/oauth", "harmoni://callback", "https://app.example.com/cb", "http://127.0.0.1/cb", "http://[::1]:8080/cb", "http://localhost:5000/"]) {
      expect(redirectProblem(ok)).toBeNull();
    }
  });
  test("refuses anything that could run or go astray", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "http://evil.example.com/cb", "https://x.example/cb#frag", "not a uri", "", 42, "intent://x"]) {
      expect(redirectProblem(bad)).not.toBeNull();
    }
  });
});

describe("redirectMatches", () => {
  test("is exact for app schemes and https", () => {
    expect(redirectMatches(["harmoni://callback"], "harmoni://callback")).toBe(true);
    expect(redirectMatches(["harmoni://callback"], "harmoni://callback/x")).toBe(false);
    expect(redirectMatches(["https://a.example/cb"], "https://a.example/cb?x=1")).toBe(false);
  });
  test("lets loopback redirects pick their port", () => {
    expect(redirectMatches(["http://127.0.0.1/cb"], "http://127.0.0.1:53121/cb")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1/cb"], "http://127.0.0.1:53121/other")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1/cb"], "http://[::1]:53121/cb")).toBe(false);
  });
});

describe("PKCE", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  test("matches the RFC 7636 example", () => {
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(validChallenge(challenge)).toBe(true);
    expect(verifierMatches(verifier, challenge)).toBe(true);
  });
  test("refuses the wrong verifier, or one too short", () => {
    expect(verifierMatches(verifier.replace("d", "e"), challenge)).toBe(false);
    expect(verifierMatches("short", challenge)).toBe(false);
  });
});

test("grantScope", () => {
  expect(grantScope(undefined)).toBe("harmoni");
  expect(grantScope("harmoni offline_access")).toBe("harmoni");
  expect(grantScope("admin")).toBeNull();
});

test("withParams keeps what's there", () => {
  expect(withParams("com.example:/cb?a=1", { code: "x", state: undefined })).toBe("com.example:/cb?a=1&code=x");
});
