/**
 * SSR-safe, failure-tolerant localStorage wrapper.
 *
 * Includes a one-time migration for the `vedhi.*` -> `vedhic.*` brand rename.
 * See `migrateLegacyKeys` for why the old keys are not simply abandoned.
 */

/** Legacy namespace written by previous builds, mapped to its replacement. */
const LEGACY_KEY_MAP: Record<string, string> = {
  'vedhi.theme.v1': 'vedhic.theme.v1',
  'vedhi.settings.v1': 'vedhic.settings.v1',
  'vedhi.coupon.v1': 'vedhic.coupon.v1',
  'vedhi.admin.session.v1': 'vedhic.admin.session.v1',
  'vedhi.admin.session.temp.v1': 'vedhic.admin.session.temp.v1',
  'vedhi.auth.token': 'vedhic.auth.token',
  'vedhi:downloaded-invoices': 'vedhic:downloaded-invoices',
}

/** Reverse index, built once, so `get` does not rescan the map on every read. */
const LEGACY_KEY_BY_CURRENT: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_KEY_MAP).map(([legacy, current]) => [current, legacy]),
)

/**
 * Copies `vedhi.*` values onto their `vedhic.*` replacements, then drops the old
 * entries.
 *
 * WHY THIS EXISTS: the keys were renamed to correct the brand spelling. A plain
 * rename is a data-destroying operation for anything already in a browser — the
 * admin and customer sessions live under these keys, so every signed-in operator
 * and shopper would be silently logged out, and every saved cart discarded, the
 * moment the new bundle loads.
 *
 * The existing value always wins. Someone already signed in on the new build has
 * a fresher token than whatever is left over from the old one, and overwriting it
 * with the stale copy would hand back an expired session. Only the legacy key is
 * removed, and only after its value is safely in place, so an interrupted run
 * (tab closed mid-migration) resumes rather than losing data.
 *
 * Run once at startup. Every key is a plain string with no dependencies between
 * them, so the order is irrelevant.
 */
export function migrateLegacyKeys(): void {
  if (typeof window === 'undefined') return

  try {
    for (const [legacyKey, currentKey] of Object.entries(LEGACY_KEY_MAP)) {
      const raw = window.localStorage.getItem(legacyKey)
      if (raw === null) continue

      if (window.localStorage.getItem(currentKey) === null) {
        window.localStorage.setItem(currentKey, raw)
      }

      window.localStorage.removeItem(legacyKey)
    }
  } catch {
    /* quota or privacy mode - a failed migration must not stop the app booting */
  }
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback
    try {
      // Read-through to the pre-rename key. `migrateLegacyKeys` normally moves the
      // value before first render; this covers a bundle loaded without it, and any
      // key added to the map later without updating the startup call site.
      const legacyKey = LEGACY_KEY_BY_CURRENT[key]
      const raw =
        window.localStorage.getItem(key) ??
        (legacyKey !== undefined ? window.localStorage.getItem(legacyKey) : null)

      if (!raw) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },

  set<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota or privacy mode — ignore silently */
    }
  },

  remove(key: string): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}