// Harmoni's service worker: makes the installed app open instantly and
// survive a flaky connection. Audio and API data always go to the network
// (audio needs range requests; library data must be fresh).
const VERSION = "v1";
const SHELL = `harmoni-shell-${VERSION}`;
const STATIC = `harmoni-static-${VERSION}`;
const ART = `harmoni-art-${VERSION}`;
const ART_LIMIT = 400;

self.addEventListener("install", () => {
  // Nothing to precache: pages are saved as they're visited (a signed-out
  // "/" is a redirect to /login, which mustn't become the offline page).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL, STATIC, ART];
      for (const key of await caches.keys()) if (!keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Build output is content-hashed: cache forever.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Cover art rarely changes: show the cached copy, refresh it quietly.
  if (/^\/api\/(songs|albums|artists)\/[^/]+\/(artwork|image)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(ART).then(async (cache) => {
        const hit = await cache.match(req);
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone()).then(() => trim(ART, ART_LIMIT));
            return res;
          })
          .catch(() => hit);
        return hit ?? fresh;
      }),
    );
    return;
  }

  // Pages: network first, fall back to the last copy (or the home shell) offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && !res.redirected) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match(req)) ?? (await cache.match("/")) ?? Response.error();
        }
      })(),
    );
  }
});
