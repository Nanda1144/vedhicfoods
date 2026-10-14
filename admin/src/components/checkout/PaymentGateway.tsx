import { useEffect, useRef, useState } from 'react'
import type { PaymentMethod } from '@/types'
import { formatCurrency } from '@/utils/format'
import { Button, Icon, Spinner } from '../common'

const GATEWAY_STEPS = [
  'Contacting the bank…',
  'Authorising payment…',
  'Confirming with Razorpay…',
]

type GatewayPhase = 'idle' | 'processing' | 'success' | 'failed'

interface PaymentGatewayProps {
  amount: number
  method: PaymentMethod
  methodLabel: string
  onSuccess: () => void
  onBack: () => void
}

export function PaymentGateway({ amount, method, methodLabel, onSuccess, onBack }: PaymentGatewayProps) {
  const [phase, setPhase] = useState<GatewayPhase>('idle')
  const [stepIndex, setStepIndex] = useState(0)
  const failRef = useRef(false)
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  const clearTimers = () => {
    timers.current.forEach((id) => clearTimeout(id))
    timers.current = []
  }

  useEffect(() => clearTimers, [])

  const schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    timers.current.push(id)
  }

  const startPayment = (forcedFail = false) => {
    clearTimers()
    if (forcedFail) failRef.current = true
    setPhase('processing')
    setStepIndex(0)
    schedule(() => setStepIndex(1), 850)
    schedule(() => setStepIndex(2), 1700)
    schedule(() => {
      const failed = failRef.current || Math.random() < 0.15
      if (failed) {
        setPhase('failed')
        return
      }
      setPhase('success')
      schedule(onSuccess, 950)
    }, 2500)
  }

  const retry = () => {
    failRef.current = false
    startPayment()
  }

  if (phase === 'processing') {
    return (
      <div className="payment-progress" role="status" aria-live="polite">
        <Spinner size={36} />
        <h3 className="address-form__title">Processing payment</h3>
        <ul className="payment-progress__steps">
          {GATEWAY_STEPS.map((label, index) => (
            <li
              key={label}
              className={index < stepIndex ? 'is-done' : index === stepIndex ? 'is-active' : undefined}
            >
              {index < stepIndex ? <Icon name="check" size={14} /> : <span className="payment-progress__dot" />}
              {label}
            </li>
          ))}
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
        <p>
          {formatCurrency(amount)} paid via {methodLabel}. Confirming your order…
        </p>
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
        <p>Your bank declined the transaction. No money has been charged and your basket is safe.</p>
        <div className="payment-result__actions">
          <Button onClick={retry} icon="refresh">
            Try again
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Change payment method
          </Button>
        </div>
      </div>
    )
  }

  const methodLabelFor = method === 'razorpay' ? 'Razorpay · UPI / Card / Netbanking' : methodLabel

  return (
    <div className="payment-gateway">
      <div className="payment-gateway__summary">
        <span className="payment-gateway__amount">
          <Icon name="rupee" size={16} /> {formatCurrency(amount)}
        </span>
        <span className="payment-gateway__method">{methodLabelFor}</span>
      </div>
      <Button size="lg" fullWidth icon="lock" onClick={() => startPayment()}>
        Pay {formatCurrency(amount)} securely
      </Button>
      <p className="payment-gateway__demo">
        Prototype payment — no real money moves.
        <button type="button" className="link-button" onClick={() => startPayment(true)}>
          Simulate a failed payment
        </button>
      </p>
      <p className="payment-gateway__secure">
        <Icon name="shield" size={14} /> 256-bit encrypted · Razorpay-ready architecture
      </p>
    </div>
  )
}