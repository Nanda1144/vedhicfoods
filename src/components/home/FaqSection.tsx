import { useMemo } from 'react'
import { Accordion, SectionHeader, SectionLink, SmartImage, Icon } from '@/components/common'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'

/** Categories most useful to a first-time shopper. */
const PREFERRED = new Set(['Shipping', 'Delivery', 'Orders', 'Products', 'Returns', 'Payments', 'Storage'])

/** Editorial image that leads the FAQ block. */
const FAQ_IMAGE_SRC =
  'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=900&q=80'

interface FaqSectionProps {
  limit?: number
  eyebrow?: string
  title?: string
  description?: string
}

/**
 * Compact, reusable FAQ block for the home/contact/about pages.
 * Lazy-loads the FAQ catalogue and shows the most useful questions next to
 * an editorial image, with a link through to the full help centre.
 */
export function FaqSection({
  limit = 6,
  eyebrow = 'Good to know',
  title = 'Questions, answered',
  description = 'Straight answers about our products, shipping, orders and returns.',
}: FaqSectionProps) {
  const loaded = useAsync(() => contentService.faqs(), [])

  const items = useMemo(() => {
    const source = loaded.data ?? []
    const ranked = [...source].sort((a, b) => {
      const rank = (category: string) => (PREFERRED.has(category) ? 0 : 1)
      return rank(a.category) - rank(b.category) || a.question.localeCompare(b.question)
    })
    return ranked.slice(0, limit)
  }, [loaded.data, limit])

  if (items.length === 0) return null

  return (
    <section className="section section--tinted faq-sec" aria-label="Frequently asked questions">
      <div className="container">
        <SectionHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          action={<SectionLink to="/faq">View all FAQs</SectionLink>}
        />
        <div className="faq-sec__body">
          <figure className="faq-sec__media">
            <SmartImage src={FAQ_IMAGE_SRC} alt="Whole spices and pantry staples on a dark kitchen counter" aspect="portrait" seed="faq-pantry" />
            <span className="faq-sec__media-badge">
              <Icon name="leaf" size={12} />
              Straight answers
            </span>
          </figure>
          <div className="faq-sec__list">
            <Accordion
              exclusive
              items={items.map((faq) => ({ id: faq.id, label: faq.question, content: <p>{faq.answer}</p> }))}
            />
          </div>
        </div>
      </div>
    </section>
  )
}