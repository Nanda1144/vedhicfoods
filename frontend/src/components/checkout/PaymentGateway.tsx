import { useState } from 'react'
import type { PaymentMethod } from '@/types'
import { formatCurrency } from '@/utils/format'
import { Button, Icon, Spinner } from '../common'

type GatewayPhase = 'idle' | 'processing' | 'success' | 'failed'

interface PaymentGatewayProps {
  amount: number
  method: PaymentMethod
  methodLabel: string
  /** Runs the real payment flow: create order → Razorpay checkout → verify. */
  onPay: () => Promise<void>
  onBack: () => void
  /** Blocks payment (e.g. unresolved stock issues). */
  disabled?: boolean
}

/**
 * Payment gateway trigger.
 *
 * This component renders the *state* of a real payment: the customer taps
 * "Pay", the parent runs the actual Razorpay orchestration through
 * `paymentService` (create gateway order → open checkout modal → verify HMAC
 * signature server-side), and this component reflects the outcome. It never
 * fabricates success, failure or delays — money moving is entirely the
 * backend's business.
 */
export function PaymentGateway({ amount, method, methodLabel, onPay, onBack, disabled = false }: PaymentGatewayProps) {
  const [phase, setPhase] = useState<GatewayPhase>('idle')
  const [failedMessage, setFailedMessage] = useState('')

  const startPayment = async () => {
    if (disabled) return
    setPhase('processing')
    setFailedMessage('')
    try {
      await onPay()
      setPhase('success')
    } catch (caught) {
      setFailedMessage(caught instanceof Error ? caught.message : 'Payment could not be completed.')
      setPhase('failed')
    }
  }

  if (phase === 'processing') {
    return (
      <div className="payment-progress" role="status" aria-live="polite">
        <Spinner size={36} />
        <h3 className="address-form__title">Processing payment</h3>
        <ul className="payment-progress__steps">
          <li className="is-active">
            <span className="payment-progress__dot" />
            Opening your bank&apos;s secure payment page…
          </li>
        </ul>
      </div>
    )
  }

  if (phase === 'success') {
    return (
      <div className="payment-result payment-result--ok anim-scale-in" role="status">
        <span className="payment-result__icon">
          <Icon name="check-circle" size={40} />
        </span>
        <h3 className="address-form__title">Payment successful</h3>
        <p>{formatCurrency(amount)} paid via {methodLabel}. Confirming your order…</p>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="payment-result payment-result--error anim-fade-in" role="alert">
        <span className="payment-result__icon">
          <Icon name="alert" size={40} />
        </span>
        <h3 className="address-form__title">Payment failed</h3>
        <p>{failedMessage}</p>
        <p>No money was charged for the failed attempt. Your basket is safe.</p>
        <div className="payment-result__actions">
          <Button onClick={startPayment} icon="refresh" disabled={disabled}>
            Try again
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Change payment method
          </Button>
        </div>
      </div>
    )
  }

  const isCod = method === 'cod'
  const methodLabelFor = method === 'razorpay' ? 'Razorpay · UPI / Card / Netbanking' : methodLabel

  return (
    <div className="payment-gateway">
      <div className="payment-gateway__summary">
        <span className="payment-gateway__amount">
          <Icon name="rupee" size={16} /> {formatCurrency(amount)}
        </span>
        <span className="payment-gateway__method">{methodLabelFor}</span>
      </div>
      <Button size="lg" fullWidth icon={isCod ? 'check' : 'lock'} onClick={() => void startPayment()} disabled={disabled}>
        {isCod ? `Place order · Pay ${formatCurrency(amount)} on delivery` : `Pay ${formatCurrency(amount)} securely`}
      </Button>
      <p className="payment-gateway__secure">
        {isCod ? (
          <>
            <Icon name="rupee" size={14} /> Pay in cash when your order is delivered
          </>
        ) : (
          <>
            <Icon name="shield" size={14} /> 256-bit encrypted · Razorpay · no money moves without your confirmation
          </>
        )}
      </p>
    </div>
  )
}