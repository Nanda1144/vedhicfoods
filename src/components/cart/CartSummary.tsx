import { useState } from 'react'
import { SITE } from '@/config/site'
import { useCart } from '@/context'
import type { CartTotals } from '@/types'
import { formatCurrency } from '@/utils/format'
import { Button, Icon, Spinner } from '../common'

interface CartSummaryProps {
  totals: CartTotals
  onCheckout: () => void
  checkoutLabel?: string
  /** Compact totals without the coupon block (used on the drawer/checkout). */
  minimal?: boolean
}

export function CartSummary({ totals, onCheckout, checkoutLabel = 'Proceed to checkout', minimal = false }: CartSummaryProps) {
  const { coupon, applyCoupon, removeCoupon } = useCart()
  const [couponInput, setCouponInput] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'error' | 'ok'>('idle')
  const [message, setMessage] = useState('')

  const apply = async () => {
    if (!couponInput.trim()) return
    setState('checking')
    const result = await applyCoupon(couponInput)
    if (result.valid && result.coupon) {
      setState('ok')
      setMessage(`${result.coupon.label} applied`)
      setCouponInput('')
    } else {
      setState('error')
      setMessage(result.error ?? 'Could not apply this coupon.')
    }
  }

  const remainingForFree = SITE.freeShippingThreshold - totals.subtotal
  const progress = Math.min(100, (totals.subtotal / SITE.freeShippingThreshold) * 100)

  return (
    <aside className="summary-card" aria-label="Order summary">
      <h2 className="summary-card__title">Order summary</h2>

      {!minimal && (
        <div className="summary-card__shipping">
          {remainingForFree > 0 ? (
            <p className="summary-card__shipping-copy">
              Add <strong>{formatCurrency(remainingForFree)}</strong> more for <strong>free shipping</strong>
            </p>
          ) : (
            <p className="summary-card__shipping-copy">
              <Icon name="truck" size={16} /> You've unlocked <strong>free shipping</strong>
            </p>
          )}
          <div className="free-ship-progress" role="progressbar" aria-label="Progress to free shipping" aria-valuenow={Math.round(progress)}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <dl className="summary-card__rows">
        <div className="row row--between">
          <dt>Subtotal</dt>
          <dd>{formatCurrency(totals.subtotal)}</dd>
        </div>
        {totals.savings > 0 && (
          <div className="row row--between summary-card__savings">
            <dt>Savings (MRP)</dt>
            <dd>− {formatCurrency(totals.savings)}</dd>
          </div>
        )}
        <div className="row row--between">
          <dt>Shipping</dt>
          <dd>{totals.shipping === 0 ? 'Free' : formatCurrency(totals.shipping)}</dd>
        </div>
        <div className="row row--between">
          <dt>Tax (GST 5%)</dt>
          <dd>{formatCurrency(totals.tax)}</dd>
        </div>
        {totals.discount > 0 && coupon && (
          <div className="row row--between summary-card__discount">
            <dt>Coupon {coupon.code}</dt>
            <dd>− {formatCurrency(totals.discount)}</dd>
          </div>
        )}
        <div className="row row--between summary-card__total">
          <dt>Total</dt>
          <dd>{formatCurrency(totals.total)}</dd>
        </div>
      </dl>

      {!minimal && (
        <div className="summary-card__coupon">
          {coupon ? (
            <div className="coupon-applied">
              <Icon name="check-circle" size={18} />
              <span>{coupon.label}</span>
              <button type="button" onClick={removeCoupon}>
                Remove
              </button>
            </div>
          ) : (
            <div className="coupon-row">
              <input
                type="text"
                placeholder="Coupon code (try VEDHI100)"
                aria-label="Coupon code"
                value={couponInput}
                onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                onKeyDown={(event) => event.key === 'Enter' && void apply()}
              />
              <Button size="sm" variant="secondary" onClick={() => void apply()} loading={state === 'checking'}>
                Apply
              </Button>
            </div>
          )}
          {state === 'ok' && message && <p className="coupon-msg">{message}</p>}
          {state === 'error' && message && <p className="coupon-msg coupon-msg--error">{message}</p>}
        </div>
      )}

      <Button fullWidth size="lg" iconRight="arrow-right" onClick={onCheckout}>
        {checkoutLabel}
      </Button>

      <p className="summary-card__secure">
        <Icon name="lock" size={14} /> Secure payment via Razorpay · GST invoice
      </p>
    </aside>
  )
}

export function SummaryLoader() {
  return (
    <div className="summary-card summary-card--loading" aria-busy="true">
      <Spinner size={24} />
      <p>Calculating your order…</p>
    </div>
  )
}