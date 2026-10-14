import { Link } from 'react-router-dom'
import { useSettings } from '@/context'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import { PageHeader, SectionLink, Icon, Skeleton, type IconName } from '@/components/common'

const CATEGORY_ICONS: Record<string, IconName> = {
  order: 'package-open',
  payment: 'wallet',
  product: 'leaf',
  wholesale: 'users',
}

const CATEGORY_ANCHORS: Record<string, string> = {
  order: 'orders',
  payment: 'payments',
  product: 'ingredients',
  wholesale: 'wholesale',
}

const QUICK_LINKS = [
  { label: 'Track or cancel an order', to: '/faq#orders' },
  { label: 'Returns & refunds', to: '/faq#returns' },
  { label: 'Shipping & delivery', to: '/faq#shipping' },
  { label: 'GST invoices', to: '/contact' },
  { label: 'Wholesale & gifting', to: '/faq#wholesale' },
]

export function SupportPage() {
  const { settings } = useSettings()
  const categories = useAsync(() => contentService.supportCategories(), [])

  return (
    <>
      <PageHeader
        eyebrow="Help centre"
        title="How can we help?"
        description="Track orders, manage returns and find answers — without the runaround."
        align="center"
      />

      <section className="section">
        <div className="container">
          <div className="support-grid">
            {categories.loading
              ? Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} style={{ width: '100%', height: 148 }} />
                ))
              : categories.data?.map((category) => (
                  <Link
                    key={category.id}
                    to={`/faq#${CATEGORY_ANCHORS[category.id] ?? 'products'}`}
                    className="support-card"
                  >
                    <span className="support-card__icon">
                      <Icon name={CATEGORY_ICONS[category.id] ?? 'box'} size={22} />
                    </span>
                    <strong>{category.title}</strong>
                    <span>{category.copy}</span>
                    <span className="support-card__cta">
                      Browse help <Icon name="arrow-right" size={14} />
                    </span>
                  </Link>
                ))}
          </div>

          <div className="support-strip">
            <div className="support-strip__copy">
              <h2>Order not tracking?</h2>
              <p>
                Write to us with your order number and our team will respond within 24 hours — usually much faster.
              </p>
              <div className="cluster cluster-3">
                <SectionLink to="/contact">Contact the team</SectionLink>
                <a href={`tel:${settings.supportPhone.replace(/\s/g, '')}`} className="support-strip__phone">
                  <Icon name="phone" size={15} /> {settings.supportPhone}
                </a>
              </div>
            </div>

            <aside className="support-quick">
              <p className="type-label">Quick answers</p>
              <ul>
                {QUICK_LINKS.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to}>
                      {link.label} <Icon name="chevron-right" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}