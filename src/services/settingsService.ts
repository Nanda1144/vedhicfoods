import { DEFAULT_WEBSITE_SETTINGS, STORAGE_KEYS } from '@/config/site'
import type { WebsiteSettings } from '@/types'
import { storage } from '@/utils/storage'
import { mockRequest, type RequestOptions } from './http'

/**
 * Website settings would normally be fetched once at boot from
 * GET /settings and cached. The prototype persists admin edits locally so
 * the "theme & branding" admin screen feels real.
 *
 * Stored values are merged over the defaults so a stale or hand-edited
 * localStorage payload (missing fields) can never produce `undefined`
 * settings at runtime.
 */
function normalizeStored(stored: unknown): WebsiteSettings {
  if (stored && typeof stored === 'object') {
    return { ...DEFAULT_WEBSITE_SETTINGS, ...(stored as Partial<WebsiteSettings>) }
  }
  return DEFAULT_WEBSITE_SETTINGS
}

function readStored(): WebsiteSettings {
  return normalizeStored(storage.get<unknown>(STORAGE_KEYS.settings, null))
}

export const settingsService = {
  async get(options?: RequestOptions): Promise<WebsiteSettings> {
    return mockRequest(() => readStored(), { delay: 180, ...options })
  },

  async update(patch: Partial<WebsiteSettings>, options?: RequestOptions): Promise<WebsiteSettings> {
    const next = normalizeStored({ ...readStored(), ...patch })
    storage.set(STORAGE_KEYS.settings, next)
    return mockRequest(() => next, { delay: 420, ...options })
  },

  read(): WebsiteSettings {
    return readStored()
  },
}