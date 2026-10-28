import type { ProviderErrorKind } from "../providers/errors";

// Per-provider circuit breaker. A provider that keeps failing is benched for
// a while, so a dead provider doesn't cost a timeout on every song.
const WINDOW_MS = 60_000;
const FAILURES_TO_BENCH = 3;
const BENCH_MS = 60_000;
const AUTH_BENCH_MS = 15 * 60_000;

interface ProviderHealth {
  failures: number[]; // timestamps within the window
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
export function recordFailure(prefix: string, kind: ProviderErrorKind | "Unknown") {
  if (kind === "NotFound") return;
  const h = get(prefix);
  const now = Date.now();
  if (kind === "AuthFailed") {
    h.benchedUntil = now + AUTH_BENCH_MS;
    return;
  }
  h.failures = [...h.failures.filter((t) => now - t < WINDOW_MS), now];
  if (h.failures.length >= FAILURES_TO_BENCH) {
    h.benchedUntil = now + BENCH_MS;
    h.failures = [];
    console.warn(`health: benched ${prefix} for ${BENCH_MS / 1000}s`);
  }
}
