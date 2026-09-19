import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { orderService } from '@/services/orderService'
import { useAsync } from '@/hooks'
import { useCart } from '@/context'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { PageHeader, ButtonLink, LoadingState, Badge } from '@/components/common'
import { Icon } from '@/components/common'

export function OrderSuccessPage() {
  const { orderNumber = '' } = useParams()
  const { clear } = useCart()
  const order = useAsync(() => orderService.byNumber(orderNumber, { delay: 600 }), [orderNumber])

  useEffect(() => {
    clear()
  }, [clear])

  if (order.loading) {
    return (
      <section className="section">
        <div className="container">
          <LoadingState title="Loading your order" description="Fetching confirmation details…" />
        </div>
      </section>
    )
  }

  if (order.error || !order.data) {
    return (
      <PageHeader eyebrow="Order" title="Order not found" />
    )
  }

  const data = order.data

  return (
    <>
      <section className="order-success-hero success-x">
        <div className="container center">
          <div className="success-x__seal" aria-hidden="true">
            <span className="success-x__ring success-x__ring--a" />
            <span className="success-x__ring success-x__ring--b" />
            <span className="success-x__spark success-x__spark--1" />
            <span className="success-x__spark success-x__spark--2" />
            <span className="success-x__spark success-x__spark--3" />
            <span className="order-success-hero__check">
              <Icon name="check" size={34} />
            </span>
          </div>

          <p className="type-eyebrow">Order {data.orderNumber} · placed {formatDateTime(data.placedAt)}</p>

          <h1 className="success-x__title">
            Goodness is <em>on its way.</em>
          </h1>

          <p className="order-success-hero__hint">
            A confirmation has been sent to <strong>{data.customerEmail}</strong>. We dispatch fresh batches within
            48 hours.
          </p>

          <p className="success-x__total">
            <span>Order total</span>
            <strong>{formatCurrency(data.total)}</strong>
          </p>

          <div className="cluster cluster-3">
            <a className="btn btn--outline" href="#order-summary">
              <Icon name="eye" size={18} />
              <span>View order</span>
            </a>
            <ButtonLink to={`/invoice/${data.invoiceId ?? ''}`} variant="outline" icon="download">
              View invoice
            </ButtonLink>
            <ButtonLink to="/shop" iconRight="arrow-right">
              Continue shopping
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="section" id="order-summary">
        <div className="container">
          <div className="order-confirm-grid">
            <div className="order-card">
              <h2 className="order-card__title">Items</h2>
              <ul className="order-card__lines">
                {data.items.map((item) => (
                  <li key={item.productId} className="row row--between">
                    <span>
                      {item.name} <span className="order-card__meta">× {item.quantity} · {item.unit}</span>
                    </span>
                    <strong>{formatCurrency(item.price * item.quantity)}</strong>
                  </li>
                ))}
              </ul>
              <div className="order-card__totals">
                <div className="row row--between"><span>Subtotal</span><span>{formatCurrency(data.subtotal)}</span></div>
                <div className="row row--between"><span>Shipping</span><span>{data.shipping === 0 ? 'Free' : formatCurrency(data.shipping)}</span></div>
                <div className="row row--between"><span>Tax (GST 5%)</span><span>{formatCurrency(data.tax)}</span></div>
                {data.discount > 0 && (
                  <div className="row row--between"><span>Coupon</span><span>− {formatCurrency(data.discount)}</span></div>
                )}
                <div className="row row--between order-card__grand"><span>Total</span><strong>{formatCurrency(data.total)}</strong></div>
              </div>
            </div>

            <div className="order-card">
              <h2 className="order-card__title">Delivery</h2>
              <p>
                {data.address.fullName}<br />
                {data.address.line1}
                {data.address.line2 ? <><br />{data.address.line2}</> : null}
                <br />
                {data.address.city}, {data.address.state} {data.address.pincode}
                <br />+{data.address.phone.replace(/^\+/, '')}
              </p>
              <div className="cluster cluster-3 order-card__meta-cluster">
                <Badge tone="info">Payment: {data.paymentStatus}</Badge>
                <Badge tone="success">Status: {data.status}</Badge>
              </div>
            </div>

            <div className="order-card order-card--wide">
              <h2 className="order-card__title">Order timeline</h2>
              <ol className="order-timeline">
                {data.timeline.map((entry) => (
                  <li key={entry.status} className={entry.completed ? 'is-complete' : undefined}>
                    <span className="order-timeline__dot" aria-hidden="true" />
                    <span>
                      <strong>{entry.label}</strong>
                      {entry.completed && <span className="order-timeline__at">{formatDateTime(entry.at)}</span>}
                      {entry.note && <span className="order-timeline__note">{entry.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <div className="order-support">
            <Icon name="mail" size={18} />
            <p>
              Questions about this order?{' '}
              <Link to="/support">Visit our support centre</Link> or reply to your confirmation email.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}