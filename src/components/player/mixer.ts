// The player's volume, and fading it: crossfading into the next song, and
// easing in and out of pauses. Fades follow the songs' own clocks where
// they can, so a throttled background tab still lands them on time.
//
// iPhones and iPads don't let pages set an element's volume at all; there
// nothing fades, and Settings says so.

let fadeSupported: boolean | undefined;
export function canFade(): boolean {
  if (typeof window === "undefined") return false;
  if (fadeSupported === undefined) {
    try {
      const probe = new Audio();
      probe.volume = 0.5;
      fadeSupported = Math.abs(probe.volume - 0.5) < 0.01;
    } catch {
      fadeSupported = false;
    }
  }
  return fadeSupported;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
// Equal power: the two songs together stay about as loud as one.
const fadeOutCurve = (x: number) => Math.cos((clamp(x) * Math.PI) / 2);
const fadeInCurve = (x: number) => Math.sin((clamp(x) * Math.PI) / 2);

const PAUSE_MS = 180;
const RESUME_MS = 260;
const TICK_MS = 40;

interface Ramp {
  from: number;
  to: number;
  start: number;
  ms: number;
  done?: () => void;
}

export class Mixer {
  private level = 1;
  private muted = false;
  private gain = 1; // the main element's share of `level`
  private ramp?: Ramp; // a pause or resume, by the wall clock
  private fadeIn?: { seconds: number; from?: number }; // the next song coming in, by its clock
  private tail?: { el: HTMLAudioElement; seconds: number }; // the last song going out
  private spare?: HTMLAudioElement;
  private timer?: ReturnType<typeof setInterval>;
  // Between asking the main element for the next song and it playing. Its
  // "pause" then is the song changing, not someone pausing.
  handingOff = false;

  constructor(private readonly main: () => HTMLAudioElement | null) {}

  setLevel(level: number, muted: boolean) {
    this.level = level;
    this.muted = muted;
    this.apply();
  }

  // Easing out of a pause: it's still playing, but as good as paused.
  get pausing(): boolean {
    return this.ramp?.to === 0;
  }

  private apply() {
    const m = this.main();
    if (m) {
      m.volume = clamp(this.level * this.gain);
      m.muted = this.muted;
    }
    const t = this.tail;
    if (t) {
      const left = Number.isFinite(t.el.duration) ? t.el.duration - t.el.currentTime : 0;
      t.el.volume = clamp(this.level * fadeOutCurve(1 - left / t.seconds));
      t.el.muted = this.muted;
    }
  }

  private tick = () => {
    const m = this.main();
    if (this.ramp) {
      const r = this.ramp;
      const x = clamp((performance.now() - r.start) / r.ms);
      this.gain = r.from + (r.to - r.from) * x;
      if (x >= 1) {
        this.ramp = undefined;
        r.done?.();
      }
    } else if (this.fadeIn && m) {
      const f = this.fadeIn;
      if (f.from === undefined) this.gain = 0;
      else {
        const x = (m.currentTime - f.from) / f.seconds;
        this.gain = fadeInCurve(x);
        // Done, or they dragged back to before it started: full volume.
        if (x >= 1 || m.currentTime < f.from) {
          this.fadeIn = undefined;
          this.gain = 1;
        }
      }
    }
    if (this.tail) {
      const t = this.tail.el;
      if (t.ended || t.paused || (Number.isFinite(t.duration) && t.duration - t.currentTime <= 0.05)) this.stopTail();
    }
    this.apply();
    if (!this.ramp && !this.fadeIn && !this.tail) this.stopTicking();
  };

  private startTicking() {
    this.timer ??= setInterval(this.tick, TICK_MS);
    // Hidden tabs slow timers to a crawl; the elements' own updates keep going.
    const m = this.main();
    m?.addEventListener("timeupdate", this.tick);
    this.tail?.el.addEventListener("timeupdate", this.tick);
  }

  private stopTicking() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.main()?.removeEventListener("timeupdate", this.tick);
  }

  private stopTail() {
    const t = this.tail;
    if (!t) return;
    this.tail = undefined;
    t.el.removeEventListener("timeupdate", this.tick);
    t.el.pause();
    t.el.removeAttribute("src");
    t.el.load();
  }

  // Hands the end of the current song to a second element that fades it
  // out over `seconds`, and readies the main one to fade the next song in.
  // True once that's done: the caller then moves to the next song.
  async crossfade(seconds: number): Promise<boolean> {
    const m = this.main();
    if (!m || !canFade() || this.tail || m.paused) return false;
    const src = m.currentSrc || m.src;
    const t = (this.spare ??= new Audio());
    t.preload = "auto";
    t.volume = 0;
    t.muted = this.muted;
    t.src = src;
    t.currentTime = m.currentTime;
    try {
      await t.play();
    } catch {
      return false;
    }
    // Someone skipped, paused or seeked away while it got going.
    if ((m.currentSrc || m.src) !== src || m.paused || !Number.isFinite(t.duration)) {
      t.pause();
      return false;
    }
    try {
      t.currentTime = m.currentTime; // line up with what's playing; it's buffered
    } catch {}
    this.tail = { el: t, seconds: Math.max(1, t.duration - m.currentTime) };
    this.ramp = undefined;
    this.fadeIn = { seconds };
    this.gain = 0;
    this.handingOff = true;
    this.apply();
    this.startTicking();
    return true;
  }

  // The main element started playing: if it's the next song of a
  // crossfade, its fade in starts now.
  playing() {
    this.handingOff = false;
    const m = this.main();
    if (this.fadeIn && this.fadeIn.from === undefined && m) {
      this.fadeIn.from = m.currentTime;
      this.startTicking();
    }
  }

  // Stops any crossfade: the song going out goes, the main element is at
  // full volume (or stays where it is, to ease out from there).
  cancel(keepGain = false) {
    this.handingOff = false;
    this.stopTail();
    this.fadeIn = undefined;
    if (!this.ramp && !keepGain) this.gain = 1;
    this.apply();
  }

  pause(smooth: boolean) {
    const m = this.main();
    if (!m) return;
    const easing = smooth && canFade() && !document.hidden;
    this.cancel(easing);
    if (!easing) {
      m.pause();
      return;
    }
    this.ramp = {
      from: this.gain,
      to: 0,
      start: performance.now(),
      ms: PAUSE_MS,
      done: () => {
        m.pause();
        this.gain = 1;
      },
    };
    this.startTicking();
  }

  async play(smooth: boolean): Promise<void> {
    const m = this.main();
    if (!m) return;
    const easing = smooth && canFade() && !document.hidden;
    // A pause still easing out: keep playing, and come back up from where it got to.
    const from = this.ramp?.to === 0 ? this.gain : easing ? 0 : 1;
    this.ramp = undefined;
    this.gain = from;
    this.apply();
    await m.play();
    if (from < 1) {
      this.ramp = { from, to: 1, start: performance.now(), ms: RESUME_MS };
      this.startTicking();
    }
  }
}
