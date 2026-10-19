/* Vedhic Foods storefront service worker.
 *
 * Dependency-free, plain JS. Bump CACHE_VERSION to invalidate every cache.
 *
 * Strategy:
 *   - App shell (/, /index.html, manifest, favicon) is precached on install.
 *   - Navigation/HTML requests are network-first so the freshest app is served,
 *     degrading to the cached shell when offline.
 *   - Hashed build assets (JS/CSS/fonts/images under /assets/) are cache-first
 *     because Vite gives them content-hashed, immutable filenames.
 *   - Backend API traffic (/api/ and the api.vedhicfoods.com origin) is never
 *     cached or intercepted — it passes straight through to the network.
 *   - Cross-origin requests are ignored except Google Fonts (immutable files).
 */

'use strict'

const CACHE_VERSION = 'v1'
const CACHE_NAME = `vedhic-foods-${CACHE_VERSION}`

const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

const API_PATH_PREFIX = '/api/'
const API_ORIGIN_HOSTS = ['api.vedhicfoods.com', 'localhost:5000']
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']

const IMMUTABLE_ASSET_RE = /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico)$/i

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {
        /* A single missing shell URL must not abort installation. */
      }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

/* The page asks the waiting worker to take over so a refresh shows the new build. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

function isApiRequest(url) {
  return url.pathname.startsWith(API_PATH_PREFIX) || API_ORIGIN_HOSTS.includes(url.hostname)
}

function isFontRequest(url) {
  return FONT_ORIGINS.includes(url.origin)
}

function isImmutableAsset(url) {
  return IMMUTABLE_ASSET_RE.test(url.pathname)
}

function putInCache(request, response) {
  if (!response || (!response.ok && response.type !== 'opaque')) return
  const copy = response.clone()
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
}

self.addEventListener('fetch', (event) => {
  const request = event.request

  /* Only GET is cacheable; POST/PUT/PATCH/DELETE go straight to the network. */
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  /* Ignore non-HTTP schemes (chrome-extension:, data:, blob:, etc.). */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (url.protocol === 'chrome-extension:') return

  /* Never intercept backend API traffic. */
  if (isApiRequest(url)) return

  /* Navigations / HTML: network-first, fall back to the precached shell. */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putInCache('/index.html', response)
          return response
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/index.html'))
            .then((cached) => cached || caches.match('/')),
        ),
    )
    return
  }

  const sameOrigin = url.origin === self.location.origin

  /* Cross-origin: cache web fonts only; leave XHR/API/analytics untouched. */
  if (!sameOrigin && !isFontRequest(url)) return

  /* Immutable hashed assets and fonts: cache-first. */
  if (isImmutableAsset(url) || isFontRequest(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          putInCache(request, response)
          return response
        })
      }),
    )
    return
  }

  /* Any other same-origin GET: network-first with cache fallback. */
  event.respondWith(
    fetch(request)
      .then((response) => {
        putInCache(request, response)
        return response
      })
      .catch(() => caches.match(request)),
  )
})
