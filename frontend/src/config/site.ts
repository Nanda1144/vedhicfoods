import type { WebsiteSettings } from '@/types'

/**
 * Single source of truth for brand identity & business configuration.
 * In production this shape is hydrated from the backend `WebsiteSettings`
 * entity (admin → settings). Components read it through `settingsService`.
 */
export const SITE = {
  brandName: 'Vedhic Foods',
  brandShort: 'Vedhic',
  tagline: 'Traditional. Organic. Premium.',
  description:
    'Handcrafted millet laddus, ragi roti and heritage organic grains — sourced directly from trusted Indian farms and made in small batches.',
  // Canonical public origin. Used for absolute URLs in structured data and
  // social share cards. The previous value was
  // `https://vedhifoods.example` — a reserved name that can never be registered,
  // so every absolute URL the storefront generated was unresolvable and search
  // engines were being told the site's canonical home does not exist.
  url: 'https://vedhicfoods.com',
  supportEmail: 'care@vedhicfoods.com',
  supportPhone: '+91 90000 12345',
  whatsapp: '+91 90000 12345',
  gstin: '29ABCDE1234F1Z5',
  currency: 'INR' as const,
  currencySymbol: '₹',
  freeShippingThreshold: 999,
  standardShippingFee: 79,
  taxRate: 0.05,
  announcement: 'Free shipping on orders above ₹999 · Freshly made every week',
  socials: [
    { platform: 'instagram' as const, label: 'Instagram', href: 'https://instagram.com' },
    { platform: 'facebook' as const, label: 'Facebook', href: 'https://facebook.com' },
    { platform: 'youtube' as const, label: 'YouTube', href: 'https://youtube.com' },
  ],
} as const

export const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = {
  brandName: SITE.brandName,
  tagline: SITE.tagline,
  supportEmail: SITE.supportEmail,
  supportPhone: SITE.supportPhone,
  whatsapp: SITE.whatsapp,
  addressLine: 'No. 14, Heritage Farms Road, Kanakapura Main Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560062',
  currency: 'INR',
  gstin: SITE.gstin,
  freeShippingThreshold: SITE.freeShippingThreshold,
  standardShippingFee: SITE.standardShippingFee,
  taxRate: SITE.taxRate,
  announcement: SITE.announcement,
  announcementActive: true,
  socials: [...SITE.socials],
  businessHours: 'Mon – Sat · 9:00 AM to 7:00 PM IST',
  heroTitle: 'Traditional Indian goodness',
  heroTitleAccent: 'grown the slow way',
  heroSubtitle: SITE.description,
  heroCtaLabel: 'Shop now',
  heroImages: [],
}

/**
 * Hero background images supplied at build time.
 *
 * Used only as a fallback when the admin console has not published any hero
 * images (`website_hero_images`). Resolution order:
 *   1. `VITE_HERO_IMAGES` env override (comma-separated URLs or `/public` paths)
 *   2. Images auto-discovered in the repo-root `assests/` folder by Vite.
 *
 * The folder is viewport-aware:
 *   - `assests/desktop/` (plus any image dropped directly in `assests/`) is
 *     shown on wide screens.
 *   - `assests/mobile/` is shown on narrow screens, falling back to the desktop
 *     set while it is still empty.
 *
 * Just drop jpg/png/webp/avif files into those folders — no code change needed.
 * Restart the dev server after adding files so the glob picks them up.
 */
function discoverHeroImages(glob: Record<string, string>): string[] {
  return Object.keys(glob)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((key) => glob[key]!)
}

const HERO_ENV_OVERRIDE = ((import.meta.env.VITE_HERO_IMAGES as string | undefined) ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

const HERO_IMAGES_DESKTOP_DISCOVERED = discoverHeroImages(
  import.meta.glob<string>('@assets/*.{jpg,jpeg,png,webp,avif}', { eager: true, import: 'default' }),
).concat(
  discoverHeroImages(
    import.meta.glob<string>('@assets/desktop/**/*.{jpg,jpeg,png,webp,avif}', { eager: true, import: 'default' }),
  ),
)

const HERO_IMAGES_MOBILE_DISCOVERED = discoverHeroImages(
  import.meta.glob<string>('@assets/mobile/**/*.{jpg,jpeg,png,webp,avif}', { eager: true, import: 'default' }),
)

/** Wide-screen build-time hero backgrounds (env override wins when set). */
export const HERO_IMAGES_DESKTOP: string[] =
  HERO_ENV_OVERRIDE.length > 0 ? HERO_ENV_OVERRIDE : HERO_IMAGES_DESKTOP_DISCOVERED

/** Narrow-screen build-time hero backgrounds (env override wins when set). */
export const HERO_IMAGES_MOBILE: string[] =
  HERO_ENV_OVERRIDE.length > 0 ? HERO_ENV_OVERRIDE : HERO_IMAGES_MOBILE_DISCOVERED

/** Backwards-compatible alias: the desktop build-time set. */
export const HERO_IMAGES_FALLBACK: string[] = HERO_IMAGES_DESKTOP

export const COMPANY_MILESTONES = [
  { year: '2009', title: 'A family kitchen', copy: 'Recipes passed down three generations, first sold at a village market.' },
  { year: '2016', title: 'Direct from farms', copy: 'We partnered with 40+ smallholder organic farmers across Karnataka.' },
  { year: '2021', title: 'Certified organic', copy: 'Every grain lot traceable to a single farm and harvest season.' },
  { year: 'Today', title: 'Slow-made at scale', copy: 'Small-batch production with zero preservatives, shipped nationwide.' },
] as const

export const TRUST_BADGES = [
  { icon: 'leaf', title: 'Certified Organic', copy: 'India Organic & Jaivik Bharat certified sourcing.' },
  { icon: 'shield', title: 'No Preservatives', copy: 'Zero artificial colours, flavours or additives.' },
  { icon: 'truck', title: 'Fresh Dispatch', copy: 'Made in small batches, shipped within 48 hours.' },
  { icon: 'award', title: 'Farmer Direct', copy: 'Fair-trade pricing to 40+ partner farms.' },
] as const

export const STORAGE_KEYS = {
  cart: 'vedhic.cart.v1',
  theme: 'vedhic.theme.v1',
  settings: 'vedhic.settings.v1',
  coupon: 'vedhic.coupon.v1',
  orders: 'vedhic.orders.v1',
  adminSession: 'vedhic.admin.session.v1',
  adminData: 'vedhic.admin.data.v1',
  recentProducts: 'vedhic.recent.v1',
} as const
