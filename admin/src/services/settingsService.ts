import { DEFAULT_WEBSITE_SETTINGS } from '@/config/site'
import type { WebsiteSettings } from '@/types'
import { apiFetchRaw, getAuthToken, type RequestOptions } from './http'

/**
 * Website settings backed by the platform `SystemSetting` registry.
 *
 * Read: `GET /admin/settings` (full registry, including private keys) for
 * ADMIN/OWNER; falls back to the public `GET /settings` map for STAFF, who
 * hold no `settings.read` grant. Every key is folded over the typed defaults so
 * a missing value can never yield `undefined` at runtime.
 *
 * Write: bulk upsert through `PUT /admin/settings` (settings.update). Values
 * are stored typed — numbers, booleans, arrays and objects as JSON — which the
 * backend serialises and re-parses transparently.
 */

interface SettingItem {
  key: string
  value: unknown
}

interface SettingEntry {
  key: string
  value: unknown
  isPublic?: boolean
}

/**
 * WebsiteSettings → registry keys. `business_city / state / pincode` are not
 * seeded on the backend; they are persisted here as new keys and flagged in the
 * integration report.
 */
const KEY_MAP: Record<Exclude<keyof WebsiteSettings, 'socials' | 'heroImages'>, string> = {
  brandName: 'brand_name',
  tagline: 'brand_tagline',
  supportEmail: 'support_email',
  supportPhone: 'support_phone',
  whatsapp: 'support_whatsapp',
  addressLine: 'business_address',
  city: 'business_city',
  state: 'business_state',
  pincode: 'business_pincode',
  currency: 'default_currency',
  gstin: 'gst_number',
  freeShippingThreshold: 'free_shipping_threshold',
  standardShippingFee: 'standard_shipping_charge',
  taxRate: 'gst_rate_percent',
  announcement: 'website_announcement',
  announcementActive: 'website_announcement_active',
  businessHours: 'support_hours',
  heroTitle: 'website_hero_title',
  heroTitleAccent: 'website_hero_title_accent',
  heroSubtitle: 'website_hero_subtitle',
  heroCtaLabel: 'website_hero_cta_label',
  storyEnabled: 'website_story_enabled',
}

function listToMap(items: SettingItem[]): Map<string, unknown> {
  return new Map(items.map((item) => [item.key, item.value]))
}

function fromEntries(map: Map<string, unknown>): WebsiteSettings {
  const candidate = { ...DEFAULT_WEBSITE_SETTINGS }
  for (const field of Object.keys(KEY_MAP) as Array<Exclude<keyof WebsiteSettings, 'socials' | 'heroImages'>>) {
    const value = map.get(KEY_MAP[field])
    if (value !== undefined && value !== null) candidate[field] = value as never
  }
  const socials = map.get('website_social_links')
  if (Array.isArray(socials)) {
    candidate.socials = socials as WebsiteSettings['socials']
  } else if (typeof socials === 'string') {
    try {
      const parsed = JSON.parse(socials)
      if (Array.isArray(parsed)) candidate.socials = parsed
    } catch {
      // ignore malformed stored JSON
    }
  }
  const heroImages = map.get('website_hero_images')
  if (Array.isArray(heroImages)) {
    candidate.heroImages = heroImages.filter((entry): entry is string => typeof entry === 'string')
  } else if (typeof heroImages === 'string') {
    try {
      const parsed = JSON.parse(heroImages)
      if (Array.isArray(parsed)) candidate.heroImages = parsed.filter((entry): entry is string => typeof entry === 'string')
    } catch {
      // ignore malformed stored JSON
    }
  }
  candidate.currency = candidate.currency === 'INR' ? 'INR' : 'INR'
  return candidate
}

function toEntries(patch: Partial<WebsiteSettings>): SettingEntry[] {
  const entries: SettingEntry[] = []
  for (const field of Object.keys(patch) as Array<keyof WebsiteSettings>) {
    if (field === 'socials') {
      if (patch.socials !== undefined) entries.push({ key: 'website_social_links', value: patch.socials, isPublic: true })
      continue
    }
    if (field === 'heroImages') {
      if (patch.heroImages !== undefined) entries.push({ key: 'website_hero_images', value: patch.heroImages, isPublic: true })
      continue
    }
    const value = patch[field]
    if (value === undefined) continue
    entries.push({ key: KEY_MAP[field as keyof typeof KEY_MAP], value, isPublic: true })
  }
  return entries
}

async function fetchAdminSettings(options?: RequestOptions): Promise<Map<string, unknown>> {
  const body = await apiFetchRaw<any>('/admin/settings', undefined, options)
  const items = Array.isArray(body?.items) ? body.items : []
  return listToMap(items)
}

async function fetchPublicSettings(options?: RequestOptions): Promise<Map<string, unknown>> {
  const body = await apiFetchRaw<any>('/settings', undefined, options)
  const data = body && typeof body === 'object' && 'data' in body ? body.data : body
  return data && typeof data === 'object'
    ? new Map(Object.entries(data as Record<string, unknown>))
    : new Map<string, unknown>()
}

export const settingsService = {
  /** Reads the storefront settings, preferring the admin registry. */
  async read(options?: RequestOptions): Promise<WebsiteSettings> {
    // SettingsProvider mounts around the whole app, including the login route,
    // so this runs before any token exists. Calling the authenticated registry
    // while signed out is guaranteed to 401 and fills the console with a
    // spurious auth error on every cold load. Skip straight to the public map.
    if (!getAuthToken()) {
      return fromEntries(await fetchPublicSettings(options))
    }
    try {
      return fromEntries(await fetchAdminSettings(options))
    } catch {
      // STAFF and unauthenticated boot fall back to the public settings map.
      return fromEntries(await fetchPublicSettings(options))
    }
  },

  /** Alias retained for the mock-era name. */
  get(options?: RequestOptions): Promise<WebsiteSettings> {
    return this.read(options)
  },

  /** Bulk-persists admin settings. Throws the ServiceError when forbidden. */
  async update(patch: Partial<WebsiteSettings>, options?: RequestOptions): Promise<WebsiteSettings> {
    const settings = toEntries(patch)
    if (settings.length > 0) {
      await apiFetchRaw<any>('/admin/settings', { method: 'PUT', body: JSON.stringify({ settings }) }, options)
    }
    return this.read(options)
  },
}