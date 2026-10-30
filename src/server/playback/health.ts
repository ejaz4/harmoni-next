import type { ProviderErrorKind } from "../providers/errors";

// Per-provider circuit breaker. A provider that keeps failing is benched for
// a while, so a dead provider doesn't cost a timeout on every song. It takes
// failures on different songs: one broken song (and every copy of it) says
// nothing about the provider.
const WINDOW_MS = 60_000;
const FAILURES_TO_BENCH = 3;
const BENCH_MS = 60_000;
const AUTH_BENCH_MS = 15 * 60_000;

interface ProviderHealth {
  failures: { at: number; songId: string }[]; // within the window, one per song
  benchedUntil: number;
}

const health = new Map<string, ProviderHealth>();

function get(prefix: string): ProviderHealth {
  let h = health.get(prefix);
  if (!h) health.set(prefix, (h = { failures: [], benchedUntil: 0 }));
  return h;
}

export function isBenched(prefix: string): boolean {
  return get(prefix).benchedUntil > Date.now();
}

export function recordSuccess(prefix: string) {
  const h = get(prefix);
  h.failures = [];
  h.benchedUntil = 0;
}

// NotFound is about one item, not the provider, so it never counts here.
export function recordFailure(prefix: string, kind: ProviderErrorKind | "Unknown", songId: string) {
  if (kind === "NotFound") return;
  const h = get(prefix);
  const now = Date.now();
  if (kind === "AuthFailed") {
    h.benchedUntil = now + AUTH_BENCH_MS;
    return;
  }
  h.failures = [...h.failures.filter((f) => now - f.at < WINDOW_MS && f.songId !== songId), { at: now, songId }];
  if (h.failures.length >= FAILURES_TO_BENCH) {
    h.benchedUntil = now + BENCH_MS;
    h.failures = [];
    console.warn(`health: benched ${prefix} for ${BENCH_MS / 1000}s`);
  }
}
