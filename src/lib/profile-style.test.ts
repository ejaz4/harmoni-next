import { expect, test } from "bun:test";
import { ACCENTS, BANNERS, bannerBackground, inkFor, isBanner, isFont, isHex } from "./profile-style";

test("only real choices pass", () => {
  expect(isHex("#a59bff")).toBe(true);
  expect(isHex("a59bff")).toBe(false);
  expect(isHex("#a59bff; background: url(x)")).toBe(false);
  expect(isFont("serif")).toBe(true);
  expect(isFont("comic")).toBe(false);
  expect(isBanner("aurora")).toBe(true);
  expect(isBanner("image")).toBe(false); // only by uploading one
});

test("every banner draws from the colour, and text stays readable on it", () => {
  for (const b of BANNERS) expect(bannerBackground(b.key, "#7ab8ff")).toContain("#7ab8ff");
  expect(inkFor("#efe6d6")).toBe("#1b1813");
  expect(inkFor("#2b1055")).toBe("#f4f3f1");
  expect(ACCENTS.every(isHex)).toBe(true);
});
