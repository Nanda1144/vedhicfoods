import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { formatCurrency } from '@/utils/format'
import { stockStatus } from '@/utils/product'
import { useCart } from '@/context'
import { productService } from '@/services/productService'
import type { Product } from '@/types'
import { Badge, PriceDisplay, Rating, SmartImage, IconButton, Icon } from '../common'
import { badgesFor } from '@/utils/product'
import { QuickViewModal } from './QuickViewModal'

interface ProductCardProps {
  product: Product
  priority?: boolean
  className?: string
  /** Calls add-to-cart silently and opens the drawer (default). */
  onAdd?: ((product: Product) => void) | null
}

type AddPhase = 'idle' | 'busy' | 'done'

export function ProductCard({ product, priority = false, className, onAdd }: ProductCardProps) {
  const { add } = useCart()
  const [quickView, setQuickView] = useState(false)
  const [phase, setPhase] = useState<AddPhase>('idle')
  const timers = useRef<number[]>([])

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const badges = badgesFor(product)
  const status = stockStatus(product.stock)
  const category = productService.category(product.categorySlug)

  const handleAdd = () => {
    if (phase !== 'idle') return
    if (onAdd === null) return
    setPhase('busy')
    timers.current.push(
      window.setTimeout(() => setPhase('done'), 600),
      window.setTimeout(() => setPhase('idle'), 2000),
    )
    if (onAdd) onAdd(product)
    else add(product, 1)
  }

  return (
    <article className={cn('product-card', className)}>
      <div className="product-card__media">
        <Link to={`/product/${product.slug}`} className="product-card__media-link" aria-label={product.name}>
          <SmartImage
            src={product.images[0] ?? ''}
            alt={product.name}
            ratio="1 / 1"
            priority={priority}
            seed={product.slug}
            className="product-card__image"
          />
        </Link>

        <p className="product-card__media-caption">
          <Icon name="leaf" size={13} />
          {product.unit} · {product.netWeight} g
        </p>

        {badges.length > 0 && (
          <div className="product-card__badges">
            {badges.map((badge) => (
              <Badge key={badge.label} tone={badge.tone} dot>
                {badge.label}
              </Badge>
            ))}
          </div>
        )}

        <div className="product-card__actions">
          <IconButton
            label={`Quick view ${product.name}`}
            onClick={() => setQuickView(true)}
            className="product-card__quick"
            aria-haspopup="dialog"
          >
            <Icon name="eye" size={17} />
          </IconButton>
          <IconButton
            label={`Add ${product.name} to basket`}
            onClick={handleAdd}
            disabled={status === 'out'}
            className="product-card__add"
          >
            <Icon name={status === 'out' ? 'ban' : 'cart'} size={18} />
          </IconButton>
        </div>
      </div>

      <div className="product-card__body">
        {category && <Link to={`/shop?category=${category.slug}`} className="product-card__category">{category.name}</Link>}
        <h3 className="product-card__name">
          <Link to={`/product/${product.slug}`}>{product.name}</Link>
        </h3>
        <p className="product-card__desc clamp-2">{product.shortDescription}</p>

        <div className="product-card__row">
          <Rating value={product.rating} count={product.reviewCount} size="sm" />
        </div>

        <div className="product-card__bottom">
          <PriceDisplay price={product.price} mrp={product.mrp} size="md" />
          <span className={cn('product-card__stock', `is-${status}`)}>
            <span className="product-card__dot" aria-hidden="true" />
            {status === 'out' ? 'Out of stock' : status === 'low' ? 'Low stock' : 'In stock'}
          </span>
        </div>

        {status === 'out' ? (
          <button type="button" className="btn btn--outline btn--md product-card__cta" disabled>
            <span className="btn__label">Notify me</span>
          </button>
        ) : (
          <button
            type="button"
            className={cn('btn btn--primary btn--md product-card__cta', phase !== 'idle' && `is-${phase}`)}
            onClick={handleAdd}
            disabled={phase !== 'idle'}
            aria-live="polite"
          >
            <Icon name={phase === 'done' ? 'check' : 'cart'} size={18} />
            <span className="btn__label">
              {phase === 'busy' ? 'Adding…' : phase === 'done' ? 'Added ✓' : `Add · ${formatCurrency(product.price)}`}
            </span>
          </button>
        )}
      </div>

      <QuickViewModal product={quickView ? product : null} onClose={() => setQuickView(false)} />
    </article>
  )
}