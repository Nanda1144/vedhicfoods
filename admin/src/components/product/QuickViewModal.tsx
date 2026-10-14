import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatCurrency } from '@/utils/format'
import { stockStatus } from '@/utils/product'
import { useCart } from '@/context'
import type { Product } from '@/types'
import { Modal, Rating, PriceDisplay, QuantitySelector, Badge, Button, SmartImage } from '@/components/common'
import { badgesFor } from '@/utils/product'

interface QuickViewModalProps {
  product: Product | null
  onClose: () => void
}

export function QuickViewModal({ product, onClose }: QuickViewModalProps) {
  const { add } = useCart()
  const [quantity, setQuantity] = useState(1)

  if (!product) return null

  const status = stockStatus(product.stock)
  const out = status === 'out'

  const handleAdd = () => {
    add(product, quantity)
    onClose()
  }

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title="Quick view"
      size="lg"
      footer={
        out ? (
          <Button variant="outline" disabled className="quick-view__add" fullWidth>
            Out of stock
          </Button>
        ) : (
          <div className="quick-view__footer">
            <QuantitySelector value={quantity} max={product.stock} onChange={setQuantity} />
            <Button icon="cart" className="quick-view__add" onClick={handleAdd} disabled={out}>
              Add · {formatCurrency(product.price * quantity)}
            </Button>
            <Link to={`/product/${product.slug}`} className="btn btn--outline btn--md" onClick={onClose}>
              <span className="btn__label">Full details</span>
            </Link>
          </div>
        )
      }
    >
      <div className="quick-view">
        <div className="quick-view__media">
          <SmartImage src={product.images[0] ?? ''} alt={product.name} aspect="portrait" ratio="4 / 5" seed={product.slug} className="quick-view__image" />
        </div>
        <div className="quick-view__info">
          <div className="quick-view__badges">
            {badgesFor(product).map((badge) => (
              <Badge key={badge.label} tone={badge.tone}>
                {badge.label}
              </Badge>
            ))}
          </div>
          <h3 className="quick-view__name">
            <Link to={`/product/${product.slug}`} onClick={onClose}>
              {product.name}
            </Link>
          </h3>
          <Rating value={product.rating} count={product.reviewCount} size="sm" />
          <PriceDisplay price={product.price} mrp={product.mrp} size="lg" />
          <p className="quick-view__desc clamp-3">{product.shortDescription}</p>
          <p className="quick-view__meta">
            {product.unit} · {stockStatus(product.stock) === 'out' ? 'Out of stock' : `In stock (${product.stock})`}
          </p>
        </div>
      </div>
    </Modal>
  )
}