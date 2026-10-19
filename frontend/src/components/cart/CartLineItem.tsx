import { Link } from 'react-router-dom'
import type { CartItem } from '@/types'
import { formatCurrency } from '@/utils/format'
import { Badge, Icon, QuantitySelector, SmartImage } from '../common'

interface CartLineItemProps {
  item: CartItem
  onUpdateQuantity: (id: string, quantity: number) => void
  onRemove: (id: string) => void
  compact?: boolean
}

export function CartLineItem({ item, onUpdateQuantity, onRemove, compact = false }: CartLineItemProps) {
  const outOfStock = item.isOutOfStock === true
  const lackingStock = !outOfStock && item.hasInsufficientStock === true

  return (
    <li className={`cart-line ${compact ? 'cart-line--compact' : ''}`.trim()}>
      <Link to={`/product/${item.slug}`} className="cart-line__media" aria-label={item.name}>
        <SmartImage src={item.image} alt="" ratio="1 / 1" seed={item.slug} />
      </Link>
      <div className="cart-line__body">
        <div className="row row--between">
          <Link to={`/product/${item.slug}`} className="cart-line__name">
            {item.name}
          </Link>
          <button
            type="button"
            className="cart-line__remove icon-btn"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.name}`}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
        <p className="cart-line__meta">{item.unit}</p>
        {(outOfStock || lackingStock || item.priceChanged) && (
          <div className="cart-line__flags">
            {outOfStock && <Badge tone="danger">Out of stock</Badge>}
            {lackingStock && (
              <Badge tone="warning">
                {item.availableQuantity != null ? `Only ${item.availableQuantity} left` : 'Low stock'}
              </Badge>
            )}
            {item.priceChanged && <span className="cart-line__notice">Price updated</span>}
          </div>
        )}
        <div className="row row--between cart-line__footer">
          <QuantitySelector
            value={item.quantity}
            max={item.stock}
            size={compact ? 'sm' : 'md'}
            disabled={outOfStock}
            onChange={(quantity) => onUpdateQuantity(item.id, quantity)}
          />
          <div className="cart-line__price">
            <span>{formatCurrency(item.price * item.quantity)}</span>
            {item.mrp > item.price && <del>{formatCurrency(item.mrp * item.quantity)}</del>}
          </div>
        </div>
      </div>
    </li>
  )
}