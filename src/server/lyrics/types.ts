// Provider-independent lyrics format. Timing is optional at every level:
// "line" lyrics have startMs per line, "word" lyrics also have per-word
// timing (karaoke), "none" is plain text.

export type LyricsSync = "word" | "line" | "none";

export interface LyricWord {
  startMs: number;
  endMs?: number;
  text: string; // includes its trailing space, so words join back into the line
}

export interface LyricLine {
  startMs?: number;
  endMs?: number;
  text: string; // "" for an instrumental gap
  words?: LyricWord[];
  romanized?: string; // for Japanese/Chinese/Korean lines
}

export interface Lyrics {
  sync: LyricsSync;
  lines: LyricLine[];
  instrumental?: boolean;
}
