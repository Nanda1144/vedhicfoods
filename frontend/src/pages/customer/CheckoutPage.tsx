import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useCart, useSettings } from '@/context'
import { orderService, type CheckoutResult } from '@/services/orderService'
import { paymentService } from '@/services/paymentService'
import { orderTokenStore } from '@/services/orderTokenStore'
import { useToast } from '@/context'
import { AddressForm, emptyAddress, validateAddressFields, PaymentGateway } from '@/components/checkout'
import type { AddressFormData } from '@/components/checkout'
import { PaymentMethodSelector } from '@/components/checkout'
import { CartSummary } from '@/components/cart'
import type { PaymentMethod } from '@/types'
import { PageHeader, Button, ButtonLink, Icon } from '@/components/common'
import { formatCurrency } from '@/utils/format'

const CUSTOMER_FIELDS: Array<keyof AddressFormData> = ['fullName', 'email', 'phone']
const DELIVERY_FIELDS: Array<keyof AddressFormData> = ['line1', 'line2', 'city', 'state', 'pincode']

const STEPS = ['Customer', 'Address', 'Review', 'Payment'] as const

/** Stable idempotency key for a checkout attempt (see `idempotencyKey` below). */
function createCheckoutKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const METHOD_LABELS: Record<PaymentMethod, string> = {
  razorpay: 'Razorpay',
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net Banking',
  cod: 'Cash on Delivery',
}

export function CheckoutPage() {
  const { items, totals, coupon, clear, hydrated, hasStockIssues } = useCart()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const { push } = useToast()

  const [address, setAddress] = useState<AddressFormData>(emptyAddress())
  const [errors, setErrors] = useState<Partial<Record<keyof AddressFormData, string>>>({})
  const [payment, setPayment] = useState<PaymentMethod>('razorpay')
  const [placing, setPlacing] = useState(false)
  const [step, setStep] = useState(1)

  // Operator-controlled availability. Optimistic before the request resolves so
  // the normal path does not flash, then fail-closed if the lookup fails.
  const [paymentConfig, setPaymentConfig] = useState<{
    onlineEnabled: boolean
    methods: string[]
  } | null>(null)
  const onlineEnabled =
    (paymentConfig?.onlineEnabled ?? true) && (paymentConfig ? paymentConfig.methods.includes('razorpay') : true)

  useEffect(() => {
    let cancelled = false
    void paymentService
      .config()
      .then((config) => {
        if (cancelled) return
        setPaymentConfig({ onlineEnabled: config.onlineEnabled, methods: config.enabledMethods })
        if (!config.onlineEnabled && config.codEnabled) setPayment('cod')
      })
      .catch(() => {
        if (!cancelled) setPaymentConfig({ onlineEnabled: false, methods: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Set the moment an order succeeds. The basket is emptied right after, which
  // would otherwise trip the empty-cart guard below while this page is still
  // mounted and bounce the customer to /shop instead of /order-success.
  const [placed, setPlaced] = useState(false)

  // One stable key for this checkout attempt (page lifetime). Retrying a failed
  // payment reuses it, so the backend returns the existing order instead of
  // creating a duplicate order and a second inventory reservation.
  const idempotencyKey = useRef<string>(createCheckoutKey())

  if (hydrated && items.length === 0 && !placed) {
    return <Navigate to="/shop" replace />
  }

  const patchAddress = (patch: Partial<AddressFormData>) =>
    setAddress((current) => ({ ...current, ...patch }))

  const warnStockIssues = () => {
    push({
      title: 'Fix your basket to continue',
      description: 'Some items are out of stock or have limited availability. Remove or reduce the flagged item.',
      tone: 'danger',
    })
  }

  const validateStep = () => {
    const activeFields = step === 1 ? CUSTOMER_FIELDS : step === 2 ? DELIVERY_FIELDS : []
    const allErrors = validateAddressFields(address, { requireEmail: true })
    const filtered = Object.fromEntries(
      Object.entries(allErrors).filter(([key]) => (activeFields as readonly string[]).includes(key)),
    ) as Partial<Record<keyof AddressFormData, string>>
    setErrors(filtered)
    return Object.keys(filtered).length === 0
  }

  const goNext = () => {
    if (step === 3 && hasStockIssues) {
      warnStockIssues()
      return
    }
    if (validateStep()) {
      setStep((current) => current + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const checkoutPayload = () => ({
    customerName: address.fullName,
    customerEmail: address.email,
    phone: address.phone,
    address: {
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 || undefined,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      country: 'India',
    },
    lines: items.map((item) => ({ slug: item.slug, quantity: item.quantity })),
    paymentMethod: payment,
    couponCode: coupon?.code,
    idempotencyKey: idempotencyKey.current,
  })

  /** Places the order and persists the anonymous order-access token for guests. */
  const placeCheckout = async (): Promise<CheckoutResult> => {
    const order = await orderService.place(checkoutPayload())
    if (order.orderToken) {
      orderTokenStore.save({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        invoiceId: order.invoiceNumber ?? order.invoiceId,
        token: order.orderToken,
      })
    }
    return order
  }

  const goToSuccess = (order: CheckoutResult) => {
    push({
      title: 'Payment successful',
      description: `A confirmation and your tax invoice will be emailed to ${address.email}.`,
    })
    setPlaced(true)
    navigate(`/order-success/${order.orderNumber}`)
    // Empty the basket only once the order is actually successful. Clearing it
    // during `placeCheckout` emptied `items` while this page was still mounted,
    // so a failed online payment bounced the customer to /shop (the empty-cart
    // guard below) and made a retry impossible.
    void clear()
  }

  /**
   * Online payment — real Razorpay flow:
   * create gateway order (server handles amounts/keys) → open checkout →
   * verify HMAC server-side → invoice generated & emailed by the backend.
   */
  const payOnline = async (): Promise<void> => {
    if (hasStockIssues) {
      warnStockIssues()
      return
    }
    setPlacing(true)
    let order: CheckoutResult | null = null
    try {
      order = await placeCheckout()
      const orderToken = order.orderToken ?? null
      const init = await paymentService.createRazorpayOrder(order.orderId, { orderToken })
      const payment = await paymentService.openCheckout(init, () => {})
      await paymentService.verify(
        {
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          razorpaySignature: payment.razorpaySignature,
        },
        { orderToken },
      )
      goToSuccess(order)
    } catch (caught) {
      // The order (and its inventory reservation) is created before the customer
      // is handed to Razorpay. A dismissed/failed checkout emits no gateway
      // webhook, so release the reservation here; the endpoint is idempotent and
      // refuses once payment is captured.
      if (order) {
        orderService
          .failPayment(order.orderId, 'Payment cancelled or failed at the gateway', {
            orderToken: order.orderToken ?? undefined,
          })
          .catch(() => {
            /* best-effort: the stale-payment sweep is the backstop */
          })
      }
      push({
        title: 'Payment could not be completed',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      })
      setPlacing(false)
      throw caught
    }
  }

  /**
   * Cash on Delivery — no gateway is involved. The backend confirms the order
   * immediately and records the payment as pending collection on delivery
   * (`checkout.service.ts` COD branch). Placing the order IS the whole flow.
   *
   * This path is required: `payOnline` unconditionally creates a Razorpay order
   * and opens the checkout modal, so routing COD through it charged the customer
   * online despite their choosing to pay on delivery.
   */
  const payCod = async (): Promise<void> => {
    if (hasStockIssues) {
      warnStockIssues()
      return
    }
    setPlacing(true)
    try {
      const order = await placeCheckout()
      goToSuccess(order)
    } catch (caught) {
      push({
        title: 'Order could not be placed',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      })
      setPlacing(false)
      throw caught
    }
  }

  const stepTitles: Record<number, string> = {
    1: '1 · Who are we delivering to?',
    2: '2 · Where should we deliver?',
    3: 'Review your order',
    4: 'Complete your payment',
  }

  return (
    <>
      <PageHeader
        eyebrow="Almost there"
        title="Checkout"
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Cart', href: '/cart' }, { label: 'Checkout', current: true }]}
      />

      <section className="section">
        <div className="container">
          <ol className="checkout-steps" aria-label="Checkout progress">
            {STEPS.map((label, index) => {
              const n = index + 1
              return (
                <li
                  key={label}
                  className={n === step ? 'is-active' : n < step ? 'is-done' : undefined}
                  aria-current={n === step ? 'step' : undefined}
                >
                  {n < step ? <Icon name="check" size={14} /> : n}
                  {label}
                </li>
              )
            })}
          </ol>

          <div className="checkout-layout">
            <div className="checkout-layout__form">
              <h2 className="address-form__title">{stepTitles[step]}</h2>

              {hasStockIssues && step >= 3 && (
                <p className="checkout-stock-warning" role="alert">
                  Some items in your basket are out of stock or have limited availability. Remove or reduce the
                  flagged items before paying.
                </p>
              )}

              {step === 1 && (
                <AddressForm
                  fields={CUSTOMER_FIELDS}
                  value={address}
                  onChange={patchAddress}
                  errors={errors}
                />
              )}

              {step === 2 && (
                <AddressForm
                  fields={DELIVERY_FIELDS}
                  title={undefined}
                  value={address}
                  onChange={patchAddress}
                  errors={errors}
                />
              )}

              {step === 3 && (
                <div className="checkout-review">
                  <section className="summary-card">
                    <h3 className="summary-card__title">Items ({totals.itemCount})</h3>
                    <ul className="order-review-list">
                      {items.map((item) => (
                        <li key={item.id}>
                          <span className="order-review-list__name">
                            {item.name} <em>× {item.quantity}</em>
                          </span>
                          <span>{formatCurrency(item.price * item.quantity)}</span>
                        </li>
                      ))}
                    </ul>
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
                        <dt>Tax (GST {Math.round((settings.taxRate ?? 0.05) * 100)}%)</dt>
                        <dd>{formatCurrency(totals.tax)}</dd>
                      </div>
                      {totals.discount > 0 && coupon && (
                        <div className="row row--between summary-card__discount">
                          <dt>Coupon {coupon.code}</dt>
                          <dd>− {formatCurrency(totals.discount)}</dd>
                        </div>
                      )}
                      <div className="row row--between summary-card__total">
                        <dt>Grand total</dt>
                        <dd>{formatCurrency(totals.total)}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              )}

              {step === 4 && (
                <div className="checkout-pay">
                  <PaymentMethodSelector
                    value={payment}
                    onChange={setPayment}
                    codEnabled={settings.codEnabled}
                    onlineEnabled={onlineEnabled}
                  />
                  {!onlineEnabled && !settings.codEnabled ? (
                    <p className="field__help field__help--error" role="alert">
                      Online payments are temporarily unavailable and Cash on Delivery is not
                      offered. Please check back soon.
                    </p>
                  ) : (
                    <PaymentGateway
                      amount={totals.total}
                      method={payment}
                      methodLabel={METHOD_LABELS[payment]}
                      onPay={payment === 'cod' ? payCod : payOnline}
                      onBack={() => setStep(3)}
                      disabled={hasStockIssues}
                    />
                  )}
                </div>
              )}

              {step < 4 && (
                <div className="checkout-actions">
                  {step > 1 ? (
                    <Button variant="ghost" icon="arrow-left" onClick={() => setStep((current) => current - 1)}>
                      Back
                    </Button>
                  ) : (
                    <ButtonLinkBack />
                  )}
                  <Button size="lg" iconRight="arrow-right" onClick={goNext} loading={placing} disabled={step === 3 && hasStockIssues}>
                    {step === 3 ? 'Continue to payment' : 'Continue'}
                  </Button>
                </div>
              )}
            </div>

            <aside className="checkout-layout__summary">
              <p className="checkout-layout__summary-label">Your order ({totals.itemCount} items)</p>
              <CartSummary
                totals={totals}
                onCheckout={step >= 4 ? () => setStep(3) : goNext}
                checkoutLabel={step >= 4 ? 'Back to review' : 'Continue to payment'}
                checkoutDisabled={step === 3 && hasStockIssues}
                minimal
              />
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}

function ButtonLinkBack() {
  return (
    <ButtonLink to="/cart" variant="ghost" icon="arrow-left">
      Back to cart
    </ButtonLink>
  )
}