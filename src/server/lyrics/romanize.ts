import KuroshiroModule from "kuroshiro";
import KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import { romanize as romanizeHangul } from "es-hangul";
import { pinyin } from "pinyin-pro";
import type { LyricLine } from "./types";

export type LyricsLanguage = "ja" | "zh" | "ko";

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;

// Judged over the whole song: Japanese lyrics often have kanji-only lines
// that would look Chinese on their own.
export function detectLanguage(lines: LyricLine[]): LyricsLanguage | undefined {
  const text = lines.map((l) => l.text).join("\n");
  if (KANA.test(text)) return "ja";
  if (HANGUL.test(text)) return "ko";
  if (HAN.test(text)) return "zh";
  return undefined;
}

// kuroshiro is CommonJS with its class on `.default`; loading its dictionary takes ~1s, once.
const Kuroshiro = (KuroshiroModule as unknown as { default?: typeof KuroshiroModule }).default ?? KuroshiroModule;
let kuroshiro: Promise<KuroshiroModule> | undefined;
function getKuroshiro(): Promise<KuroshiroModule> {
  kuroshiro ??= (async () => {
    const instance = new Kuroshiro();
    await instance.init(new KuromojiAnalyzer());
    return instance;
  })().catch((err) => {
    kuroshiro = undefined;
    throw err;
  });
  return kuroshiro;
}

// Adds `romanized` to every line that has text in the song's script.
export async function romanizeLines(lines: LyricLine[], language: LyricsLanguage): Promise<void> {
  const script = language === "ja" ? /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u : language === "ko" ? HANGUL : HAN;
  for (const line of lines) {
    if (!script.test(line.text)) continue;
    line.romanized = tidy(await romanizeText(line.text, language));
  }
}

async function romanizeText(text: string, language: LyricsLanguage): Promise<string> {
  switch (language) {
    case "ja":
      return (await getKuroshiro()).convert(text, { to: "romaji", mode: "spaced", romajiSystem: "hepburn" });
    case "ko":
      return romanizeHangul(text);
    case "zh":
      return pinyin(text, { toneType: "symbol", nonZh: "consecutive" });
  }
}

// kuroshiro pads punctuation and Latin words with extra spaces.
function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s+([?!.,、。！？])/g, "$1").trim();
}
