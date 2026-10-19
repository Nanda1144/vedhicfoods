import { createContext, useContext } from 'react'
import { THEMES, type ThemeName } from '@/config/theme'
import type { WebsiteSettings } from '@/types'

export interface SettingsContextValue {
  settings: WebsiteSettings
  loading: boolean
  update: (patch: Partial<WebsiteSettings>) => Promise<WebsiteSettings>
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  themeOptions: typeof THEMES
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within a SettingsProvider')
  return context
}
