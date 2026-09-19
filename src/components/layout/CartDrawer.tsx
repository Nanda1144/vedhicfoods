import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useCart, useSettings } from '@/context'
import { formatCurrency } from '@/utils/format'
import { Icon, Drawer, Button, QuantitySelector, EmptyState } from '../common'

interface CartDrawerProps {
  open: boolean
  onClose: () => void
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
  const { items, totals, updateQuantity, remove, coupon, applyCoupon, removeCoupon } = useCart()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const location = useLocation()
  const [couponInput, setCouponInput] = useState('')
  const [couponState, setCouponState] = useState<'idle' | 'checking' | 'error' | 'ok'>('idle')
  const [couponMessage, setCouponMessage] = useState('')

  useEffect(() => {
    if (open) {
      setCouponInput('')
      setCouponState('idle')
      setCouponMessage('')
    }
  }, [open])

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) return
    setCouponState('checking')
    const result = await applyCoupon(couponInput)
    if (result.valid && result.coupon) {
      setCouponState('ok')
      setCouponMessage(`${result.coupon.label} applied`)
      setCouponInput('')
    } else {
      setCouponState('error')
      setCouponMessage(result.error ?? 'Could not apply this coupon.')
    }
  }

  const goCheckout = () => {
    onClose()
    navigate('/checkout')
  }

  const goCart = () => {
    onClose()
    if (location.pathname !== '/cart') navigate('/cart')
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={items.length ? `Your basket (${totals.itemCount})` : 'Your basket'}
      className="cart-drawer"
    >
      {items.length === 0 ? (
        <div className="cart-drawer__empty">
          <EmptyState
            title="Your basket is empty"
            description="Fresh handmade laddus and heritage grains are waiting."
            icon="cart"
            action={<ButtonLinkTo onClose={onClose} />}
          />
        </div>
      ) : (
        <>
          <FreeShippingProgress subtotal={totals.subtotal} threshold={settings.freeShippingThreshold} />
          <ul className="cart-drawer__lines">
            {items.map((item) => (
              <li key={item.id} className="cart-line">
                <Link to={`/product/${item.slug}`} onClick={onClose} className="cart-line__media">
                  <img src={item.image} alt="" loading="lazy" />
                </Link>
                <div className="cart-line__body">
                  <div className="row row--between">
                    <Link to={`/product/${item.slug}`} onClick={onClose} className="cart-line__name">
                      {item.name}
                    </Link>
                    <button
                      type="button"
                      className="cart-line__remove icon-btn"
                      onClick={() => remove(item.id)}
                      aria-label={`Remove ${item.name}`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                  <p className="cart-line__meta">{item.unit}</p>
                  <div className="row row--between">
                    <QuantitySelector value={item.quantity} max={item.stock} onChange={(qty) => updateQuantity(item.id, qty)} size="sm" />
                    <div className="cart-line__price">
                      <span>{formatCurrency(item.price * item.quantity)}</span>
                      {item.mrp > item.price && <del>{formatCurrency(item.mrp)}</del>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {!coupon && (
            <div className="cart-drawer__coupon">
              <div className="coupon-row">
                <input
                  type="text"
                  placeholder="Coupon code"
                  aria-label="Coupon code"
                  value={couponInput}
                  onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => event.key === 'Enter' && void handleApplyCoupon()}
                />
                <Button size="sm" variant="secondary" onClick={() => void handleApplyCoupon()} loading={couponState === 'checking'}>
                  Apply
                </Button>
              </div>
              {couponState === 'ok' && couponMessage && <p className="coupon-msg">{couponMessage}</p>}
              {couponState === 'error' && couponMessage && <p className="coupon-msg coupon-msg--error">{couponMessage}</p>}
            </div>
          )}

          <div className="cart-drawer__totals">
            <div className="row row--between">
              <span>Subtotal</span>
              <span>{formatCurrency(totals.subtotal)}</span>
            </div>
            {totals.savings > 0 && (
              <div className="row row--between">
                <span>You save</span>
                <span className="text-strong">− {formatCurrency(totals.savings)}</span>
              </div>
            )}
            {totals.discount > 0 && coupon && (
              <div className="row row--between">
                <span>Coupon {coupon.code}</span>
                <span className="summary-card__discount">− {formatCurrency(totals.discount)}</span>
              </div>
            )}
            <div className="row row--between">
              <span>Shipping</span>
              <span>{totals.shipping === 0 ? 'Free' : formatCurrency(totals.shipping)}</span>
            </div>
            <div className="row row--between cart-drawer__grand">
              <span>Total</span>
              <strong>{formatCurrency(totals.total)}</strong>
            </div>
          </div>
          {coupon && (
            <div className="coupon-applied cart-drawer__applied">
              <Icon name="check-circle" size={18} />
              <span>{coupon.label}</span>
              <button type="button" onClick={removeCoupon}>
                Remove
              </button>
            </div>
          )}

          <Button fullWidth size="lg" iconRight="arrow-right" onClick={() => void goCheckout()}>
            Checkout securely
          </Button>
          <button type="button" className="link-button cart-drawer__view" onClick={goCart}>
            View full cart
          </button>
          <p className="cart-drawer__secure type-caption">
            <Icon name="lock" size={13} /> Payments via Razorpay · GST invoice included
          </p>
        </>
      )}
    </Drawer>
  )
}

function ButtonLinkTo({ onClose }: { onClose: () => void }) {
  return (
    <Link to="/shop" onClick={onClose} className="btn btn--primary btn--md">
      <span className="btn__label">Shop now</span>
    </Link>
  )
}

/* -------------------------------------------------------- Free shipping nudger */

function FreeShippingProgress({ subtotal, threshold }: { subtotal: number; threshold: number }) {
  const remaining = Math.max(0, threshold - subtotal)
  const percent = Math.min(100, (subtotal / Math.max(1, threshold)) * 100)
  const unlocked = remaining === 0

  return (
    <div className="ship-progress" aria-live="polite">
      <p className="ship-progress__label">
        {unlocked ? (
          <>
            <Icon name="truck" size={15} /> Free shipping unlocked — you've earned it
          </>
        ) : (
          <>
            <Icon name="truck" size={15} /> Add <strong>{formatCurrency(remaining)}</strong> more for free shipping
          </>
        )}
      </p>
      <div className="ship-progress__track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Free shipping progress">
        <span className={unlocked ? 'is-full' : undefined} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}