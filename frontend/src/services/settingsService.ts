import { DEFAULT_WEBSITE_SETTINGS, STORAGE_KEYS } from '@/config/site'
import type { SocialLink, WebsiteSettings } from '@/types'
import { storage } from '@/utils/storage'
import { apiFetch, type RequestOptions } from './http'

/**
 * Website settings are served by `GET /api/v1/settings`, which the backend
 * restricts to settings explicitly flagged public (brand, contact details,
 * social links, hero). Admin edits therefore take effect for every visitor
 * instead of only in the browser that made them.
 *
 * IMPORTANT: the backend stores settings as a flat key/value registry using
 * snake_case keys (`brand_name`, `website_announcement`, `website_hero_title`,
 * …). The typed `WebsiteSettings` interface is camelCase. The mapping below is
 * the single place that translates between the two; without it the storefront
 * silently fell back to `DEFAULT_WEBSITE_SETTINGS` for every field and no admin
 * change ever reached the customer.
 */

/** Backend registry key → typed field. */
const BACKEND_KEYS: Record<keyof Omit<WebsiteSettings, 'socials' | 'heroImages'>, string> = {
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
  codEnabled: 'shipping_cod_enabled',
}

function coerceString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : String(value)
}

function coerceNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase()
    // Mirrors the backend's truthiness parsing (see utils/cod-settings.ts) so a
    // hand-written `1`/`yes` cannot enable COD server-side while the storefront
    // still hides the option.
    if (normalised === 'true' || normalised === '1' || normalised === 'yes') return true
    if (normalised === 'false' || normalised === '0' || normalised === 'no') return false
  }
  if (typeof value === 'number') return value !== 0
  return undefined
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    return items.length ? items : undefined
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        const items = parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        return items.length ? items : undefined
      }
    } catch {
      // A comma-separated fallback for hand-edited values.
      const items = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
      return items.length ? items : undefined
    }
  }
  return undefined
}

/** Translates the backend's flat registry map into the typed settings shape. */
function fromBackend(raw: unknown): Partial<WebsiteSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const map = raw as Record<string, unknown>
  const out: Partial<WebsiteSettings> = {}

  const textFields: Array<keyof WebsiteSettings> = [
    'brandName',
    'tagline',
    'supportEmail',
    'supportPhone',
    'whatsapp',
    'addressLine',
    'city',
    'state',
    'pincode',
    'gstin',
    'announcement',
    'businessHours',
    'heroTitle',
    'heroTitleAccent',
    'heroSubtitle',
    'heroCtaLabel',
  ]
  for (const field of textFields) {
    const value = coerceString(map[BACKEND_KEYS[field as keyof typeof BACKEND_KEYS]])
    if (value !== undefined) (out as Record<string, unknown>)[field] = value
  }

  const numberFields: Array<keyof WebsiteSettings> = [
    'freeShippingThreshold',
    'standardShippingFee',
  ]
  for (const field of numberFields) {
    const value = coerceNumber(map[BACKEND_KEYS[field as keyof typeof BACKEND_KEYS]])
    if (value !== undefined) (out as Record<string, unknown>)[field] = value
  }

  // GST is stored as a percentage (e.g. `5`); the cart maths expects a fraction.
  const gstPercent = coerceNumber(map[BACKEND_KEYS.taxRate])
  if (gstPercent !== undefined) out.taxRate = gstPercent > 1 ? gstPercent / 100 : gstPercent

  const announcementActive = coerceBoolean(map[BACKEND_KEYS.announcementActive])
  if (announcementActive !== undefined) out.announcementActive = announcementActive

  const storyEnabled = coerceBoolean(map[BACKEND_KEYS.storyEnabled])
  if (storyEnabled !== undefined) out.storyEnabled = storyEnabled

  const codEnabled = coerceBoolean(map[BACKEND_KEYS.codEnabled])
  if (codEnabled !== undefined) out.codEnabled = codEnabled

  const socials = coerceStringArray(map.website_social_links)
  if (socials) {
    out.socials = socials
      .map((entry) => {
        try {
          return JSON.parse(entry) as SocialLink
        } catch {
          return null
        }
      })
      .filter((entry): entry is SocialLink => Boolean(entry) && typeof entry === 'object')
  } else if (Array.isArray(map.website_social_links)) {
    out.socials = map.website_social_links as SocialLink[]
  }

  const heroImages = coerceStringArray(map.website_hero_images)
  if (heroImages) out.heroImages = heroImages

  return out
}

function normalize(stored: unknown): WebsiteSettings {
  if (stored && typeof stored === 'object') {
    // Merged over defaults so a partial or hand-edited payload can never
    // produce `undefined` settings at runtime.
    return { ...DEFAULT_WEBSITE_SETTINGS, ...(stored as Partial<WebsiteSettings>) }
  }
  return DEFAULT_WEBSITE_SETTINGS
}

function readCached(): WebsiteSettings {
  return normalize(storage.get<unknown>(STORAGE_KEYS.settings, null))
}

export const settingsService = {
  async get(options?: RequestOptions): Promise<WebsiteSettings> {
    const remote = await apiFetch<Record<string, unknown>>('/settings', undefined, options)
    const merged = normalize(fromBackend(remote))
    // Cache so a returning visitor paints immediately on the next load.
    storage.set(STORAGE_KEYS.settings, merged)
    return merged
  },

  /**
   * Settings are admin-managed through `PUT /api/v1/admin/settings`, which is
   * permission-gated. The storefront has no legitimate reason to write them, so
   * this no longer mutates anything locally either - callers that need to change
   * branding must go through the admin app.
   */
  async update(): Promise<WebsiteSettings> {
    throw new Error(
      'Website settings are read-only on the storefront. Update them from the admin console.',
    )
  },

  /** Synchronous read of the cached copy; used for first paint before `get()` resolves. */
  read(): WebsiteSettings {
    return readCached()
  },
}
