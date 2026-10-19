import { Link } from 'react-router-dom'
import type { StorefrontPromotion } from '@/types'
import { Icon } from '@/components/common'

export interface PromotionBannerProps {
  promotion: StorefrontPromotion
}

/**
 * Only same-origin paths and absolute http(s) URLs are clickable. Promotion
 * copy is operator-authored, but treating it as a trusted URL would let a typo
 * (or a compromised admin session) turn the storefront CTA into `javascript:`.
 */
function safeDestination(value: string | null | undefined): string | null {
  const url = (value ?? '').trim()
  if (!url) return null
  if (url.startsWith('/')) return url
  if (/^https?:\/\//i.test(url)) return url
  return null
}

export function PromotionBanner({ promotion }: PromotionBannerProps) {
  const title = (promotion.title ?? '').trim() || promotion.name
  const subtitle = (promotion.subtitle ?? '').trim() || (promotion.description ?? '').trim()
  const banner = (promotion.bannerImageUrl ?? '').trim()
  const ctaLabel = (promotion.ctaLabel ?? '').trim()
  const destination = safeDestination(promotion.destinationUrl)

  return (
    <section className="section promo-banner" aria-label="Current offer">
      <div className="container">
        <article className="promo-banner__card">
          {banner && (
            <div className="promo-banner__media">
              <img src={banner} alt={title} loading="lazy" />
            </div>
          )}
          <div className="promo-banner__copy">
            <p className="type-eyebrow">Limited-time offer</p>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
            {ctaLabel && destination && (
              destination.startsWith('/') ? (
                <Link className="btn btn--primary btn--md" to={destination}>
                  <span className="btn__label">{ctaLabel}</span>
                  <Icon name="arrow-right" size={18} />
                </Link>
              ) : (
                <a
                  className="btn btn--primary btn--md"
                  href={destination}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="btn__label">{ctaLabel}</span>
                  <Icon name="arrow-right" size={18} />
                </a>
              )
            )}
          </div>
        </article>
      </div>
    </section>
  )
}
