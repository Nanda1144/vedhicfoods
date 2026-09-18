export type ThemeName = 'forest' | 'olive' | 'harvest' | 'midnight'

export interface ThemeOption {
  name: ThemeName
  label: string
  description: string
  /** Swatches used by the admin theme picker. */
  swatches: [string, string, string]
}

export const THEMES: ThemeOption[] = [
  {
    name: 'forest',
    label: 'Deep Forest',
    description: 'The signature Vedhi palette — deep green, cream and gold.',
    swatches: ['#1f3d2b', '#6b7b3a', '#c9a24b'],
  },
  {
    name: 'olive',
    label: 'Olive Grove',
    description: 'Softer, earthier green for a rustic market feel.',
    swatches: ['#5f6f30', '#7c8c4a', '#c9a24b'],
  },
  {
    name: 'harvest',
    label: 'Harvest Brown',
    description: 'Warm brown and gold — ideal for festive gifting seasons.',
    swatches: ['#5c3f28', '#b28f3c', '#6b7b3a'],
  },
  {
    name: 'midnight',
    label: 'Midnight Grove',
    description: 'Dark, high-contrast theme for premium evening browsing.',
    swatches: ['#15291d', '#c9a24b', '#e9efe6'],
  },
]

export const THEME_ATTR = 'data-theme'

/** Applies a theme by setting a single attribute — components stay untouched. */
export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement): void {
  if (theme === 'forest') {
    root.removeAttribute(THEME_ATTR)
  } else {
    root.setAttribute(THEME_ATTR, theme)
  }
}

export function readAppliedTheme(root: HTMLElement = document.documentElement): ThemeName {
  const value = root.getAttribute(THEME_ATTR)
  return (THEMES.find((t) => t.name === value)?.name ?? 'forest') as ThemeName
}
