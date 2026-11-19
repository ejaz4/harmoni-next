// How a profile can look: the presets to pick from, shared by the server
// (which checks what's saved) and the app (which draws it).

export const ACCENTS = [
  "#efe6d6", // Harmoni cream
  "#ff8a7a", // coral
  "#ffb86b", // tangerine
  "#ffe27a", // lemon
  "#9be38f", // mint
  "#6fd6c8", // teal
  "#7ab8ff", // sky
  "#a59bff", // periwinkle
  "#e2a3ff", // lilac
  "#ff8fc7", // bubblegum
] as const;

export const DEFAULT_ACCENT = ACCENTS[0];

// Each is a CSS variable set by next/font in profile-fonts.ts.
export const FONTS = [
  { key: "default", label: "Harmoni" },
  { key: "serif", label: "Fraunces" },
  { key: "elegant", label: "Playfair" },
  { key: "grotesk", label: "Space Grotesk" },
  { key: "display", label: "Bricolage" },
  { key: "rounded", label: "Nunito" },
  { key: "mono", label: "Mono" },
  { key: "condensed", label: "Bebas" },
  { key: "script", label: "Caveat" },
  { key: "pixel", label: "Pixel" },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];

// Drawn from their accent colour, so every one goes with it.
export const BANNERS = [
  { key: "glow", label: "Glow" },
  { key: "aurora", label: "Aurora" },
  { key: "sunset", label: "Sunset" },
  { key: "tide", label: "Tide" },
  { key: "stripes", label: "Stripes" },
  { key: "dots", label: "Dots" },
  { key: "grid", label: "Grid" },
  { key: "plain", label: "Plain" },
] as const;

export type BannerKey = (typeof BANNERS)[number]["key"];

export const BIO_MAX = 300;
export const PINNED_MAX = 10;

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export const isFont = (v: unknown): v is FontKey => FONTS.some((f) => f.key === v);
export const isBanner = (v: unknown): v is BannerKey => BANNERS.some((b) => b.key === v);

export function bannerBackground(key: string | undefined, accent: string): string {
  const a = accent;
  switch (key) {
    case "aurora":
      return `radial-gradient(60% 120% at 15% 10%, ${a}cc, transparent 60%), radial-gradient(50% 100% at 85% 30%, ${shift(a, 60)}aa, transparent 60%), radial-gradient(70% 120% at 50% 120%, ${shift(a, -50)}99, transparent 60%), #141414`;
    case "sunset":
      return `linear-gradient(160deg, ${a} 0%, ${shift(a, 35)} 45%, #1a1218 100%)`;
    case "tide":
      return `linear-gradient(200deg, ${shift(a, -40)} 0%, ${a}88 50%, #0e1418 100%)`;
    case "stripes":
      return `repeating-linear-gradient(-45deg, ${a}55 0 18px, transparent 18px 36px), linear-gradient(${a}33, #151515)`;
    case "dots":
      return `radial-gradient(${a}88 1.6px, transparent 1.8px) 0 0 / 18px 18px, linear-gradient(160deg, ${a}44, #141414)`;
    case "grid":
      return `linear-gradient(${a}33 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, ${a}33 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(180deg, ${a}55, #141414)`;
    case "plain":
      return `${a}`;
    default: // glow
      return `radial-gradient(90% 140% at 20% 0%, ${a}, transparent 70%), linear-gradient(180deg, ${a}55, #141414)`;
  }
}

// The colour turned round the colour wheel by `degrees`, for a second tone.
function shift(hex: string, degrees: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl((h + degrees + 360) % 360, s, l);
}

function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

// Dark text on light accents, light on dark ones.
export function inkFor(hex: string): string {
  const [, , l] = toHsl(hex);
  return l > 0.6 ? "#1b1813" : "#f4f3f1";
}
