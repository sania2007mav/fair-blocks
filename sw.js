/**
 * Offline shell. Network-first while online, cache fallback when not.
 * Bump CACHE when a breaking change should drop old precached files.
 */
const CACHE = "chestnye-bloki-v3"
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/rng.js",
  "./js/pieces.js",
  "./js/board.js",
  "./js/scoring.js",
  "./js/generator.js",
  "./js/solver.js",
  "./js/names.js",
  "./js/firebase-config.js",
  "./js/online.js",
  "./js/game.js",
  "./js/storage.js",
  "./js/i18n.js",
  "./js/audio.js",
  "./js/render.js",
  "./js/input.js",
  "./js/main.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.hostname.endsWith("gstatic.com") || url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("firebaseapp.com")) {
    return
  }
  if (url.origin !== self.location.origin) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === "navigate") {
          return (await caches.match("./index.html")) || (await caches.match("./"))
        }
        return new Response("offline", { status: 503, headers: { "Content-Type": "text/plain" } })
      }),
  )
})
