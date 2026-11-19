import { Bebas_Neue, Bricolage_Grotesque, Caveat, Fraunces, JetBrains_Mono, Nunito, Playfair_Display, Silkscreen, Space_Grotesk } from "next/font/google";
import type { FontKey } from "@/lib/profile-style";

// The fonts a profile can pick. Not preloaded: each downloads only when a
// profile using it is shown.
const serif = Fraunces({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-serif" });
const elegant = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-elegant" });
const grotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-grotesk" });
const display = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-display" });
const rounded = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-rounded" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-mono" });
const condensed = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--pf-condensed" });
const script = Caveat({ subsets: ["latin"], display: "swap", preload: false, variable: "--pf-script" });
const pixel = Silkscreen({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--pf-pixel" });

const LOADED: Record<Exclude<FontKey, "default">, { variable: string; style: { fontFamily: string } }> = {
  serif,
  elegant,
  grotesk,
  display,
  rounded,
  mono,
  condensed,
  script,
  pixel,
};

// The class that defines the font's variable, and the font-family to use.
export function profileFont(key: string | undefined): { className: string; family: string } {
  const font = key && key !== "default" ? LOADED[key as Exclude<FontKey, "default">] : undefined;
  return font ? { className: font.variable, family: font.style.fontFamily } : { className: "", family: "var(--font)" };
}
