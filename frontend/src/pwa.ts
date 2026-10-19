/**
 * Registers the storefront service worker (public/sw.js) in production builds.
 *
 * Registration is best-effort: a failure here must never break the app, so the
 * whole thing is wrapped and deferred until after `load`.
 */

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const hadController = Boolean(navigator.serviceWorker.controller)
  let refreshing = false

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Offline support is a progressive enhancement; ignore failures. */
    })
  })

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return
    refreshing = true
    window.location.reload()
  })

  navigator.serviceWorker.ready
    .then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
    })
    .catch(() => {
      /* Ignore: no active worker (e.g. unsupported or blocked). */
    })
}
