"use client";

import { useEffect, useRef } from "react";
import styles from "./spice-grinder.module.css";

// Your Spice being made: a jar of fine glitter, shaken. The same scene as the
// phone app's: gravity, a swing, bounces, tosses out of a settled bed; every
// fleck shimmers at its own pace, now and then one catches the light in an
// eight-point glint that swells and fades, and film grain crawls over it
// all. In colours from the Spice's name. Drawn on a canvas, paused when it
// isn't on screen; with reduced motion, a still of the settled jar.

const N = 900;
const LAYERS = 9; // three tones × three brightnesses

function hash(s: string) {
  let h = 2166136261;
  for (const c of s.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

interface Sim {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  bed: Float32Array; // how far above the floor each grain settles: the grains make a bed
  sp: Float32Array; // shimmer speed and phase
  ph: Float32Array;
  gt: Float32Array; // a glint in progress: time left, length, strength
  gd: Float32Array;
  gs: Float32Array;
  t: number;
  toss: number;
}

function makeSim(size: number): Sim {
  const pad = size * 0.04;
  const s: Sim = {
    x: new Float32Array(N),
    y: new Float32Array(N),
    vx: new Float32Array(N),
    vy: new Float32Array(N),
    bed: new Float32Array(N),
    sp: new Float32Array(N),
    ph: new Float32Array(N),
    gt: new Float32Array(N),
    gd: new Float32Array(N),
    gs: new Float32Array(N),
    t: 0,
    toss: 0.4,
  };
  for (let i = 0; i < N; i++) {
    const u = Math.random();
    s.bed[i] = u * u * size * 0.16;
    s.x[i] = pad + Math.random() * (size - 2 * pad);
    s.y[i] = size - pad - s.bed[i] - Math.random() * size * 0.5;
    s.sp[i] = 3 + Math.random() * 14;
    s.ph[i] = Math.random() * Math.PI * 2;
  }
  return s;
}

// A tile of random grey for the film grain.
function grainTile(): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 128;
  const ctx = tile.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tile;
}

// A soft round halo, drawn once and stamped behind the brightest flecks.
function haloSprite(px: number): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = Math.max(4, Math.ceil(px));
  const ctx = sprite.getContext("2d")!;
  const r = sprite.width / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255, 246, 230, 0.9)");
  g.addColorStop(0.45, "rgba(255, 246, 230, 0.35)");
  g.addColorStop(1, "rgba(255, 246, 230, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sprite.width, sprite.height);
  return sprite;
}

export function SpiceGrinder({ seed, className }: { seed: string; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const h = hash(seed || "spice");
    const A = h % 360;
    const B = (A + 40 + ((h >>> 9) % 90)) % 360;
    const tones = [`${A}, 85%, 68%`, `${B}, 80%, 62%`, `${(A + 25) % 360}, 95%, 82%`];
    const alphas = [0.28, 0.6, 1];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const grain = ctx.createPattern(grainTile(), "repeat");

    let size = 0;
    let sim: Sim | undefined;
    let halo: HTMLCanvasElement | undefined;
    let backdrop: CanvasGradient | undefined;
    let glow: CanvasGradient | undefined;
    const layers: number[][] = Array.from({ length: LAYERS }, () => []);
    const sparks: number[] = [];
    const glints: number[] = [];

    const resize = () => {
      const width = el.clientWidth;
      if (!width || width === size) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size = width;
      el.width = el.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sim = makeSim(size);
      halo = haloSprite(size * 0.06);
      backdrop = ctx.createLinearGradient(0, 0, size, size);
      backdrop.addColorStop(0, `hsl(${A}, 38%, 13%)`);
      backdrop.addColorStop(1, `hsl(${B}, 32%, 7%)`);
      glow = ctx.createRadialGradient(size / 2, size * 0.95, 0, size / 2, size * 0.95, size * 0.7);
      glow.addColorStop(0, `hsla(${A}, 70%, 45%, 0.28)`);
      glow.addColorStop(1, `hsla(${A}, 70%, 45%, 0)`);
    };

    const step = (dt: number) => {
      const s = sim!;
      const pad = size * 0.04;
      const min = pad;
      const max = size - pad;
      const mid = size / 2;
      s.t += dt;
      s.toss -= dt;
      const w = Math.PI * 2 * 2.2;
      const pull = size * 0.022 * w * w * Math.sin(w * s.t);
      const g = size * 5;
      const tossing = s.toss <= 0;
      if (tossing) s.toss = 0.45 + Math.random() * 0.6;

      for (const l of layers) l.length = 0;
      sparks.length = 0;
      glints.length = 0;

      for (let i = 0; i < N; i++) {
        s.vx[i] += (pull + (Math.random() - 0.5) * size * 6) * dt;
        s.vy[i] += g * dt;
        // The bed is a mound, higher in the middle.
        const dx = (s.x[i] - mid) / mid;
        const floor = max - s.bed[i] * (1 - dx * dx * 0.55);
        if (tossing && s.y[i] > floor - size * 0.05) s.vy[i] -= size * (0.7 + Math.random() * 1.7);
        s.x[i] += s.vx[i] * dt;
        s.y[i] += s.vy[i] * dt;
        if (s.x[i] < min) {
          s.x[i] = min;
          s.vx[i] = -s.vx[i] * 0.5;
        } else if (s.x[i] > max) {
          s.x[i] = max;
          s.vx[i] = -s.vx[i] * 0.5;
        }
        if (s.y[i] > floor) {
          s.y[i] = floor;
          s.vy[i] = -s.vy[i] * 0.25;
          s.vx[i] *= 0.82;
        } else if (s.y[i] < min) {
          s.y[i] = min;
          s.vy[i] = Math.abs(s.vy[i]) * 0.3;
        }
        const px = s.x[i];
        const py = s.y[i];
        const speed = Math.abs(s.vx[i]) + Math.abs(s.vy[i]);

        // Now and then a fleck catches the light; flying ones more often.
        if (s.gt[i] <= 0 && Math.random() < dt * 0.014 * (1 + Math.min(4, speed / (size * 1.5)))) {
          s.gd[i] = 0.28 + Math.random() * 0.3;
          s.gt[i] = s.gd[i];
          s.gs[i] = 0.55 + Math.random() * 0.6;
        }
        if (s.gt[i] > 0) {
          s.gt[i] -= dt;
          const e = Math.sin(Math.PI * (1 - Math.max(0, s.gt[i]) / s.gd[i]));
          glints.push(px, py, size * 0.034 * s.gs[i] * e);
          sparks.push(px, py);
          continue;
        }

        // Every fleck shimmers: a fast twinkle of its own, plus flicker when it moves.
        const tw = 0.5 + 0.5 * Math.sin(s.t * s.sp[i] + s.ph[i]) + (speed > size * 0.4 ? (Math.random() - 0.5) * 0.6 : 0);
        if (tw > 0.993) {
          sparks.push(px, py);
          continue;
        }
        const level = tw > 0.72 ? 2 : tw > 0.38 ? 1 : 0;
        layers[(i % 3) * 3 + level].push(px, py);
      }
    };

    const draw = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = backdrop!;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = glow!;
      ctx.fillRect(0, 0, size, size);

      const fine = Math.max(1, size * 0.0062);
      for (let k = 0; k < LAYERS; k++) {
        const tone = Math.floor(k / 3);
        const d = fine * (tone === 2 ? 0.8 : 1);
        const pts = layers[k];
        ctx.fillStyle = `hsla(${tones[tone]}, ${alphas[k % 3]})`;
        ctx.beginPath();
        for (let j = 0; j < pts.length; j += 2) ctx.rect(pts[j] - d / 2, pts[j + 1] - d / 2, d, d);
        ctx.fill();
      }

      // Flecks at their brightest, with a soft halo.
      const hs = halo!.width;
      ctx.globalAlpha = 0.5;
      for (let j = 0; j < sparks.length; j += 2) ctx.drawImage(halo!, sparks[j] - hs / 2, sparks[j + 1] - hs / 2, hs, hs);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      const sd = fine * 1.3;
      for (let j = 0; j < sparks.length; j += 2) ctx.rect(sparks[j] - sd / 2, sparks[j + 1] - sd / 2, sd, sd);
      ctx.fill();

      // Glints: four rays, two long and two short diagonals.
      ctx.strokeStyle = "#fff";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(0.6, size * 0.0032);
      ctx.beginPath();
      for (let j = 0; j < glints.length; j += 3) {
        const x = glints[j];
        const y = glints[j + 1];
        const a = glints[j + 2];
        const dd = a * 0.32;
        ctx.moveTo(x - a, y);
        ctx.lineTo(x + a, y);
        ctx.moveTo(x, y - a * 0.8);
        ctx.lineTo(x, y + a * 0.8);
        ctx.moveTo(x - dd, y - dd);
        ctx.lineTo(x + dd, y + dd);
        ctx.moveTo(x - dd, y + dd);
        ctx.lineTo(x + dd, y - dd);
      }
      ctx.stroke();

      // Crawling film grain: the noise jumps every frame.
      if (grain) {
        const ox = Math.floor(Math.random() * 128);
        const oy = Math.floor(Math.random() * 128);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.1;
        ctx.translate(-ox, -oy);
        ctx.fillStyle = grain;
        ctx.fillRect(0, 0, size + 128, size + 128);
        ctx.translate(ox, oy);
      }
    };

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      if (still && sim) settle();
    });
    observer.observe(el);

    // Reduced motion: let the glitter settle, then draw it once.
    const settle = () => {
      for (let i = 0; i < 180; i++) step(1 / 60);
      draw();
    };
    if (still) {
      if (sim) settle();
      return () => observer.disconnect();
    }

    let frame = 0;
    let last = 0;
    let visible = true;
    const tick = (now: number) => {
      frame = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.033, (now - last) / 1000) : 1 / 60;
      last = now;
      if (sim) {
        step(dt);
        draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (frame || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const seen = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      start();
    });
    seen.observe(el);
    document.addEventListener("visibilitychange", start);
    start();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, [seed]);

  return <canvas ref={canvas} className={`${styles.grinder} ${className ?? ""}`} aria-hidden />;
}

// The grinder's words, for a Spice that's still being made.
export function GrindingNote({ body = "Finding songs that go with the ones you picked." }: { body?: string }) {
  return (
    <>
      <span className={styles.grinding}>Grinding your Spice…</span>
      <span className={styles.grindingBody}>{body}</span>
    </>
  );
}
