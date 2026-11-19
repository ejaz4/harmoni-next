// Text normalisation for matching. Providers format the same song very
// differently ("Baby (feat. Ludacris)" vs "Baby" + a featured artist),
// so titles are broken into a core, featured artists and version tags.

export function normalizeText(s: string): string {
  return s
    // Stylised letters, so "Ke$ha" == "Kesha", "A$AP" == "ASAP", "P!nk" == "Pink".
    .replace(/\$(?=\p{L})|(?<=\p{L})\$/gu, "s")
    .replace(/(?<=\p{L})!(?=\p{L})/gu, "i")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Tags that mean a different recording. Two songs whose tags differ never match.
const VERSION_TAGS: [tag: string, pattern: RegExp][] = [
  // Spotify Singles are new recordings made live in Spotify's studio.
  ["live", /\blive\b|\bunplugged\b|\bspotify singles?\b/],
  ["remix", /\bremix\b|\brmx\b/],
  ["acoustic", /\bacoustic\b/],
  ["instrumental", /\binstrumental\b/],
  ["karaoke", /\bkaraoke\b/],
  ["acapella", /\ba ?cappella\b|\bacapella\b/],
  ["sped up", /\bsped up\b|\bspeed up\b/],
  ["slowed", /\bslowed\b/],
  ["reverb", /\breverb\b/],
  ["nightcore", /\bnightcore\b/],
  ["8d", /\b8d\b/],
  ["demo", /\bdemo\b/],
  ["cover", /\bcover\b/],
  ["extended", /\bextended\b/],
  ["edit", /\bedit\b/],
  ["clean", /\bclean\b/],
];

// Dubbed/translated versions ("[German]", "(Versión en Español)") are separate
// recordings. Matched only when the bracket or dash part is just the language,
// so titles like "French Kiss" are unaffected.
const LANGUAGES: Record<string, string> = {
  english: "english", german: "german", deutsch: "german", french: "french", francais: "french",
  spanish: "spanish", espanol: "spanish", castellano: "spanish", castilian: "spanish", latino: "spanish",
  italian: "italian", italiano: "italian", portuguese: "portuguese", portugues: "portuguese",
  brazilian: "portuguese", japanese: "japanese", korean: "korean", chinese: "chinese",
  mandarin: "chinese", cantonese: "cantonese", dutch: "dutch", polish: "polish", russian: "russian",
  swedish: "swedish", norwegian: "norwegian", danish: "danish", finnish: "finnish", hindi: "hindi",
  arabic: "arabic", turkish: "turkish", greek: "greek", hebrew: "hebrew",
};
const LANGUAGE_NAMES = Object.keys(LANGUAGES).join("|");
const LANGUAGE_PART = new RegExp(
  `^(?:(${LANGUAGE_NAMES})(?: (?:version|ver|edition|dub|language|lyrics))?|(?:version|ver) (?:en |in )?(${LANGUAGE_NAMES}))$`,
);

// Labels that describe the same recording, so they are ignored. Remasters
// sound nearly identical and providers label them inconsistently.
const SOFT = /\bremaster(ed)?\b|\bmono\b|\bstereo\b|\bdeluxe\b|\bbonus track\b/;

const NOISE =
  /^(official( music)?( video| audio| lyric video| visuali[sz]er)?|(official )?lyrics?( video)?|audio|visuali[sz]er|hd|hq|4k|explicit|music video|mv)$/;

const FEAT = /^(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i;
const INLINE_FEAT = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i;
const BRACKETS = /[([]([^)\]]*)[)\]]/g;
const DASH = /\s+[-–—]\s+/;

type Part =
  | { kind: "feat"; artists: string[] }
  | { kind: "noise" }
  | { kind: "soft" }
  | { kind: "tags"; tags: string[] }
  | { kind: "other" };

function classify(raw: string): Part {
  const feat = raw.trim().match(FEAT);
  if (feat) return { kind: "feat", artists: splitArtistNames([feat[1]]) };
  const text = normalizeText(raw);
  if (NOISE.test(text)) return { kind: "noise" };
  const language = text.match(LANGUAGE_PART);
  if (language) return { kind: "tags", tags: [`lang:${LANGUAGES[language[1] ?? language[2]]}`] };
  const tags = VERSION_TAGS.filter(([, p]) => p.test(text)).map(([t]) => t);
  if (tags.length) return { kind: "tags", tags };
  if (SOFT.test(text)) return { kind: "soft" };
  return { kind: "other" };
}

// Whether an album is a live recording: "Futttura Live", "Hybrid Theory (Live)",
// "Live at Wembley", "MTV Unplugged", "Vivir (En Vivo)". Deezer often leaves
// "(Live)" off the tracks of a live album, where YouTube Music keeps it, so
// the album has to say it instead. Album titles merely using the word
// ("Live Your Life") don't count.
const LIVE_ALBUM =
  /[([]\s*(?:live|en vivo|ao vivo|unplugged)\b[^)\]]*[)\]]|(?:^|\s[-–—]?\s*)(?:live|en vivo|ao vivo)\s*$|^live (?:at|in|from|on)\b|\bunplugged\b/i;

export function isLiveAlbum(name: string | undefined): boolean {
  return !!name && LIVE_ALBUM.test(name.trim());
}

export interface ParsedTitle {
  core: string;
  // The same title in another script: YouTube Music writes "君のせい - Kiminosei"
  // where Deezer has "Kiminosei", so each half can match on its own.
  alts: string[];
  featured: string[];
  tags: Set<string>;
}

export function parseTitle(title: string): ParsedTitle {
  const featured: string[] = [];
  const tags = new Set<string>();
  const unclassified: string[] = [];
  const absorb = (part: Part) => {
    if (part.kind === "feat") featured.push(...part.artists);
    if (part.kind === "tags") part.tags.forEach((t) => tags.add(t));
  };

  // Bracketed groups never belong to the core title.
  let rest = title.replace(BRACKETS, (_, inner: string) => {
    const part = classify(inner);
    absorb(part);
    if (part.kind === "other") unclassified.push(inner);
    return " ";
  });

  // " - Live", " - Remastered 2011": only strip dash segments that classify.
  const [head, ...segments] = rest.split(DASH);
  const kept = [head];
  for (const segment of segments) {
    const part = classify(segment);
    if (part.kind === "other") kept.push(segment);
    else absorb(part);
  }
  rest = kept.join(" ");

  const inline = rest.match(INLINE_FEAT);
  if (inline) {
    featured.push(...splitArtistNames([inline[1]]));
    rest = rest.slice(0, inline.index);
  }

  // Only parts written in different scripts count as translations;
  // "Run - Away" must not match a song called "Away".
  const alts: string[] = [];
  const addIfTranslation = (a: string, b: string) => {
    const sa = scriptOf(a);
    const sb = scriptOf(b);
    if (sa && sb && sa !== sb) alts.push(normalizeText(a), normalizeText(b));
  };
  if (kept.length > 1) addIfTranslation(kept[0], kept.slice(1).join(" "));
  for (const inner of unclassified) addIfTranslation(rest, inner);

  return { core: normalizeText(rest), alts: [...new Set(alts)].filter(Boolean), featured, tags };
}

function scriptOf(s: string): "latin" | "other" | undefined {
  const letters = s.match(/\p{L}/gu);
  if (!letters) return undefined;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin * 2 > letters.length ? "latin" : "other";
}

// The title Harmoni shows: featured credits and noise removed, versions kept.
export function displayTitle(title: string): string {
  const drop = (raw: string) => {
    const kind = classify(raw).kind;
    return kind === "feat" || kind === "noise";
  };
  let out = title.replace(BRACKETS, (whole, inner: string) => (drop(inner) ? "" : whole));
  const [head, ...segments] = out.split(DASH);
  out = [head, ...segments.filter((s) => !drop(s))].join(" - ");
  out = out.replace(INLINE_FEAT, "");
  return out.replace(/\s+/g, " ").trim();
}

const ARTIST_SPLIT = /\s*,\s*|\s+&\s+|\s+(?:and|x|with|feat\.?|ft\.?|featuring|vs\.?)\s+/i;

// Raw artist names, split into individual credits, in credit order.
export function splitArtistNames(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const cleaned = name.replace(/\s+-\s+topic$/i, "").replace(/vevo$/i, "");
    for (const piece of cleaned.split(ARTIST_SPLIT)) {
      const trimmed = piece.trim();
      if (trimmed && !out.some((o) => normalizeText(o) === normalizeText(trimmed))) {
        out.push(trimmed);
      }
    }
  }
  return out;
}
