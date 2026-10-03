// Offline copy of the app: every page and file of the app itself is fetched fresh when there is a
// network and kept; without one, the kept copy is used. Other sites (the bead images, the AI) pass
// straight through.
const CACHE = 'pindou-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit ?? caches.match(self.registration.scope))),
  )
})
