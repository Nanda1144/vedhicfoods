/**
 * A festive campaign published from the admin console.
 *
 * `title`/`subtitle` are the banner-facing copy; `name`/`description` are the
 * original campaign fields kept as fallbacks so banners created before the
 * dedicated copy columns existed still render.
 */
export interface StorefrontPromotion {
  id: string
  name: string
  slug: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  bannerImageUrl?: string | null
  destinationUrl?: string | null
  ctaLabel?: string | null
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT'
  discountValue: number
  startDate: string
  endDate: string
  priority: number
}
