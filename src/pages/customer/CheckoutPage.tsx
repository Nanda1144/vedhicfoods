import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useCart } from '@/context'
import { orderService } from '@/services/orderService'
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

const METHOD_LABELS: Record<PaymentMethod, string> = {
  razorpay: 'Razorpay',
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net Banking',
  cod: 'Cash on Delivery',
}

export function CheckoutPage() {
  const { items, totals, coupon, clear } = useCart()
  const navigate = useNavigate()
  const { push } = useToast()

  const [address, setAddress] = useState<AddressFormData>(emptyAddress())
  const [errors, setErrors] = useState<Partial<Record<keyof AddressFormData, string>>>({})
  const [payment, setPayment] = useState<PaymentMethod>('razorpay')
  const [placing, setPlacing] = useState(false)
  const [step, setStep] = useState(1)

  if (items.length === 0) {
    return <Navigate to="/shop" replace />
  }

  const patchAddress = (patch: Partial<AddressFormData>) =>
    setAddress((current) => ({ ...current, ...patch }))

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
    if (validateStep()) {
      setStep((current) => current + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const placeOrder = async () => {
    setPlacing(true)
    try {
      const order = await orderService.place({
        customerName: address.fullName,
        customerEmail: address.email,
        phone: address.phone,
        address: {
          id: `addr-checkout`,
          label: 'Delivery',
          fullName: address.fullName,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2 || undefined,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          country: 'India',
          isDefault: true,
        },
        lines: items.map((item) => ({ slug: item.slug, quantity: item.quantity })),
        paymentMethod: payment,
        couponCode: coupon?.code,
        discount: coupon?.amount ?? 0,
      })
      clear()
      push({ title: 'Order placed', description: `${order.orderNumber} is confirmed.` })
      navigate(`/order-success/${order.orderNumber}`)
    } catch (caught) {
      push({
        title: 'Could not place your order',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      })
      setPlacing(false)
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
                        <dt>Grand total</dt>
                        <dd>{formatCurrency(totals.total)}</dd>
                      </div>
                    </dl>
                  </section>
                </div>
              )}

              {step === 4 && (
                <div className="checkout-pay">
                  <PaymentMethodSelector value={payment} onChange={setPayment} />
                  <PaymentGateway
                    amount={totals.total}
                    method={payment}
                    methodLabel={METHOD_LABELS[payment]}
                    onSuccess={() => void placeOrder()}
                    onBack={() => setStep(3)}
                  />
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
                  <Button size="lg" iconRight="arrow-right" onClick={goNext} loading={placing}>
                    {step === 3 ? 'Continue to payment' : 'Continue'}
                  </Button>
                </div>
              )}
            </div>

            <aside className="checkout-layout__summary">
              <p className="checkout-layout__summary-label">Your order ({totals.itemCount} items)</p>
              <CartSummary
                totals={totals}
                onCheckout={() => (step >= 4 ? setStep(3) : setStep(4))}
                checkoutLabel={step >= 4 ? 'Back to review' : 'Continue to payment'}
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