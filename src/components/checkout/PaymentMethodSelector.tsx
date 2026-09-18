import type { PaymentMethod } from '@/types'
import { Radio, type IconName } from '../common'

export const PAYMENT_METHODS: Array<{
  id: PaymentMethod
  label: string
  description: string
  icon: IconName
}> = [
  { id: 'razorpay', label: 'Razorpay — UPI / Card / Netbanking', description: 'Pay securely via UPI, credit/debit cards, netbanking or wallets', icon: 'wallet' },
]

interface PaymentMethodSelectorProps {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
  error?: string
}

export function PaymentMethodSelector({ value, onChange, error }: PaymentMethodSelectorProps) {
  return (
    <div className="payment-methods">
      <fieldset className="payment-methods__set">
        <legend className="address-form__title">Payment method</legend>
        <div className={error ? 'payment-methods__list payment-methods__list--error' : 'payment-methods__list'}>
          {PAYMENT_METHODS.map((method) => (
            <Radio
              key={method.id}
              label={method.label}
              description={method.description}
              name="payment-method"
              value={method.id}
              checked={value === method.id}
              onChange={() => onChange(method.id)}
            />
          ))}
        </div>
        {error && <p className="field__help field__help--error">{error}</p>}
      </fieldset>
    </div>
  )
}