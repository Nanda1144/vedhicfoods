import { useMemo } from 'react'
import { PageHeader, Accordion, ButtonLink, Skeleton } from '@/components/common'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'

const CATEGORY_ANCHORS: Record<string, string> = {
  Products: 'products',
  Ingredients: 'ingredients',
  Shipping: 'shipping',
  Delivery: 'delivery',
  Orders: 'orders',
  Payments: 'payments',
  Returns: 'returns',
  Storage: 'storage',
  'Shelf life': 'shelf-life',
  Discounts: 'discounts',
  Wholesale: 'wholesale',
}

export function FaqPage() {
  const loaded = useAsync(() => contentService.faqs(), [])
  const groups = useMemo(() => {
    const source = loaded.data ?? []
    const map = new Map<string, typeof source>()
    for (const faq of source) {
      const list = map.get(faq.category) ?? []
      list.push(faq)
      map.set(faq.category, list)
    }
    return Array.from(map.entries())
  }, [loaded.data])

  return (
    <>
      <PageHeader
        eyebrow="Help centre"
        title="Frequently asked questions"
        description="Straight answers about our products, shipping, orders and returns."
        align="center"
      />

      <section className="section section--narrow">
        <div className="container">
          {loaded.loading ? (
            <div className="stack stack-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} style={{ width: '100%', height: 56 }} />
              ))}
            </div>
          ) : (
            groups.map(([category, items]) => (
            <div
              key={category}
              id={CATEGORY_ANCHORS[category]}
              className="faq-group"
            >
              <h2 className="faq-group__title">{category}</h2>
              <Accordion
                exclusive
                items={items.map((faq) => ({ id: faq.id, label: faq.question, content: <p>{faq.answer}</p> }))}
              />
            </div>
            ))
          )}

          <div className="faq-foot">
            <p>Still have a question?</p>
            <ButtonLink to="/contact" variant="outline">
              Contact support
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  )
}