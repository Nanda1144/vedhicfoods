import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { DEFAULT_WEBSITE_SETTINGS, STORAGE_KEYS } from '@/config/site'
import { applyTheme, readAppliedTheme, THEMES, type ThemeName } from '@/config/theme'
import { settingsService } from '@/services/settingsService'
import { storage } from '@/utils/storage'
import type { WebsiteSettings } from '@/types'

interface SettingsContextValue {
  settings: WebsiteSettings
  loading: boolean
  update: (patch: Partial<WebsiteSettings>) => Promise<WebsiteSettings>
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  themeOptions: typeof THEMES
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<WebsiteSettings>(DEFAULT_WEBSITE_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [theme, setThemeState] = useState<ThemeName>('forest')

  useEffect(() => {
    setSettings(settingsService.read())
    setThemeState(readAppliedTheme())
    setLoading(false)
  }, [])

  const update = useCallback(async (patch: Partial<WebsiteSettings>) => {
    const next = await settingsService.update(patch)
    setSettings(next)
    return next
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

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within a SettingsProvider')
  return context
}