import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { STORAGE_KEYS } from '@/config/site'
import { applyTheme, readAppliedTheme, THEMES, type ThemeName } from '@/config/theme'
import { settingsService } from '@/services/settingsService'
import { storage } from '@/utils/storage'
import type { WebsiteSettings } from '@/types'
import { SettingsContext } from './useSettings'

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Paint from the cached copy first so there is no flash of default branding,
  // then reconcile against GET /settings. Previously this only ever read
  // localStorage and immediately set loading=false, so branding and contact
  // details could never change for anyone but the browser that edited them.
  const [settings, setSettings] = useState<WebsiteSettings>(() => settingsService.read())
  const [loading, setLoading] = useState(true)
  const [theme, setThemeState] = useState<ThemeName>(() => readAppliedTheme())

  useEffect(() => {
    let cancelled = false

    void settingsService
      .get()
      .then((remote) => {
        if (!cancelled) setSettings(remote)
      })
      .catch(() => {
        // The cached copy stays on screen. Surfaced rather than swallowed: a
        // storefront showing stale contact details is a real support problem,
        // so this is logged instead of failing silently.
        if (!cancelled) {
          console.warn(
            '[settings] Could not load website settings from the API; using the cached copy.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Retained so existing callers keep compiling, but branding is admin-managed
   * through `PUT /api/v1/admin/settings`. It now rejects instead of quietly
   * writing to localStorage, which previously reported success for a change
   * that was never persisted anywhere the customer could see.
   */
  const update = useCallback(async (_patch: Partial<WebsiteSettings>) => {
    throw new Error(
      'Website settings can only be changed from the admin console.',
    )
  }, [])

  const setTheme = useCallback((next: ThemeName) => {
    applyTheme(next)
    storage.set(STORAGE_KEYS.theme, next)
    setThemeState(next)
  }, [])

  const value = useMemo(
    () => ({ settings, loading, update, theme, setTheme, themeOptions: THEMES }),
    [settings, loading, update, theme, setTheme],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}