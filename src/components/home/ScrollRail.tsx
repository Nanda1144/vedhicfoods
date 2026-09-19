import { useCallback, useEffect, useRef, useState } from 'react'
import type { Product } from '@/types'
import { Icon, IconButton, SectionLink } from '@/components/common'
import { ProductCard } from '@/components/product'

interface ScrollRailProps {
  products: Product[]
  eyebrow?: string
  title: string
  description?: string
  viewAllTo?: string
}

/**
 * Editorial horizontal product journey — large cards, scroll-snap aligned,
 * with visible prev/next controls. Safe to use with a mouse, trackpad,
 * keyboard arrows and touch.
 */
export function ScrollRail({ products, eyebrow, title, description, viewAllTo }: ScrollRailProps) {
  const railRef = useRef<HTMLUListElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(true)

  const update = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const max = rail.scrollWidth - rail.clientWidth - 4
    setCanLeft(rail.scrollLeft > 4)
    setCanRight(rail.scrollLeft < max)
  }, [])

  useEffect(() => {
    update()
    const rail = railRef.current
    if (!rail) return
    rail.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      rail.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update, products.length])

  const scrollBy = useCallback((direction: 1 | -1) => {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * rail.clientWidth * 0.82, behavior: 'smooth' })
  }, [])

  if (!products.length) return null

  return (
    <section className="section section--alt rail-section" aria-label={title}>
      <div className="container">
        <div className="rail-section__head">
          <div>
            {eyebrow && <p className="type-eyebrow">{eyebrow}</p>}
            <h2 className="section-title rail-section__title">{title}</h2>
            {description && <p className="rail-section__desc">{description}</p>}
          </div>
          <div className="rail-section__controls">
            {viewAllTo && (
              <SectionLink to={viewAllTo} className="rail-section__view">
                View all
              </SectionLink>
            )}
            <IconButton label="Scroll left" onClick={() => scrollBy(-1)} disabled={!canLeft}>
              <Icon name="arrow-left" size={18} />
            </IconButton>
            <IconButton label="Scroll right" onClick={() => scrollBy(1)} disabled={!canRight}>
              <Icon name="arrow-right" size={18} />
            </IconButton>
          </div>
        </div>

        <ul ref={railRef} className="rail" tabIndex={-1} aria-label={`${title} — scrollable`}>
          {products.map((product, index) => (
            <li key={product.id} className="rail__item">
              <ProductCard product={product} priority={index < 2} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}