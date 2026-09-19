import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { formatCurrency } from '@/utils/format'
import { stockStatus } from '@/utils/product'
import { productService } from '@/services/productService'
import { useCart } from '@/context'
import type { Product } from '@/types'
import {
  Icon,
  IconButton,
  Rating,
  PriceDisplay,
  QuantitySelector,
  ButtonLink,
} from '@/components/common'

interface ShowcaseProps {
  products: Product[]
}

type AddPhase = 'idle' | 'busy' | 'done'

/** ADD → ADDING… → ADDED ✓ micro-interaction used across the storefront. */
function useAddFeedback(): [AddPhase, () => void] {
  const [phase, setPhase] = useState<AddPhase>('idle')
  const guard = useRef(false)
  const timers = useRef<number[]>([])

  const run = useCallback(() => {
    if (guard.current) return
    guard.current = true
    setPhase('busy')
    timers.current.push(
      window.setTimeout(() => setPhase('done'), 620),
      window.setTimeout(() => {
        setPhase('idle')
        guard.current = false
      }, 2100),
    )
  }, [])

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  return [phase, run]
}

/**
 * Editorial "premium showcase" — one large featured product at a time.
 * Image left, story right; prev/next crossfades between products.
 * Never hides price, availability or the purchase action.
 */
export function ProductShowcase({ products }: ShowcaseProps) {
  const { add, open } = useCart()
  const navigate = useNavigate()
  const [active, setActive] = useState(0)
  const [quantity, setQuantity] = useState(1)
  const [phase, runAdd] = useAddFeedback()

  const product = products[active]
  const status = product ? stockStatus(product.stock) : 'out'
  const out = !product || status === 'out'
  const category = product ? productService.category(product.categorySlug) : undefined

  const go = useCallback(
    (delta: number) => {
      setActive((current) => (current + delta + products.length) % products.length)
      setQuantity(1)
    },
    [products.length],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  if (!product) return null
  const price = product.price * quantity

  const handleAdd = () => {
    if (out) return
    add(product, quantity)
    runAdd()
    open()
  }

  const handleBuyNow = () => {
    if (out) return
    add(product, quantity, true)
    navigate('/checkout')
  }

  return (
    <section className="section showcase" aria-label="Featured product">
      <div className="container showcase__inner">
        <div className="showcase__media">
          <div className="showcase__frame">
            <img
              key={product.id}
              src={product.images[0] ?? ''}
              alt={product.name}
              className="showcase__image"
            />
            <span className="showcase__badge">Featured of the week</span>
          </div>
          <div className="showcase__nav" role="group" aria-label="Change featured product">
            <IconButton label="Previous product" onClick={() => go(-1)}>
              <Icon name="arrow-left" size={18} />
            </IconButton>
            <IconButton label="Next product" onClick={() => go(1)}>
              <Icon name="arrow-right" size={18} />
            </IconButton>
          </div>
        </div>

        <div className="showcase__copy" aria-live="polite">
          {category && <a href={`/shop?category=${category.slug}`} className="showcase__category">{category.name}</a>}
          <h2 className="showcase__name">{product.name}</h2>
          <Rating value={product.rating} count={product.reviewCount} />
          <p className="showcase__story">{product.shortDescription}</p>

          <ul className="showcase__ingredients" aria-label="Key ingredients">
            {product.ingredients.slice(0, 4).map((ingredient) => (
              <li key={ingredient}>{ingredient}</li>
            ))}
          </ul>

          <div className="showcase__meta">
            <PriceDisplay price={product.price} mrp={product.mrp} size="lg" />
            <span className="showcase__unit">{product.unit} · {product.netWeight} g</span>
            <span className={cn('showcase__stock', `is-${status}`)}>
              <span className="showcase__dot" aria-hidden="true" />
              {status === 'out' ? 'Out of stock' : status === 'low' ? 'Only a few left' : 'In stock · fresh batch'}
            </span>
          </div>

          <div className="showcase__buy">
            <QuantitySelector value={quantity} max={Math.min(99, product.stock)} onChange={setQuantity} disabled={out} />
            <button
              type="button"
              className={cn('btn btn--primary btn--lg showcase__add', phase !== 'idle' && `is-${phase}`)}
              disabled={out || phase !== 'idle'}
              onClick={handleAdd}
            >
              <Icon name={phase === 'done' ? 'check' : 'cart'} size={20} />
              <span className="btn__label">
                {out
                  ? 'Out of stock'
                  : phase === 'busy'
                    ? 'Adding…'
                    : phase === 'done'
                      ? 'Added to your table'
                      : `Add to your table · ${formatCurrency(price)}`}
              </span>
            </button>
          </div>

          <div className="showcase__actions">
            <ButtonLink to={`/product/${product.slug}`} variant="outline" iconRight="arrow-right">
              Full story &amp; nutrition
            </ButtonLink>
            <button type="button" className="link-button" onClick={handleBuyNow} disabled={out}>
              Buy now
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}