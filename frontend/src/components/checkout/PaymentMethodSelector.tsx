import type { PaymentMethod } from '@/types'
import { Radio, type IconName } from '../common'

interface PaymentMethodOption {
  id: PaymentMethod
  label: string
  description: string
  icon: IconName
}

/**
 * Online payment is mandatory and always offered; Razorpay is the default.
 * Cash on Delivery is optional and only shown once an operator enables it.
 */
const RAZORPAY_METHOD: PaymentMethodOption = {
  id: 'razorpay',
  label: 'Razorpay — UPI / Card / Netbanking',
  description: 'Pay securely via UPI, credit/debit cards, netbanking or wallets',
  icon: 'wallet',
}

const COD_METHOD: PaymentMethodOption = {
  id: 'cod',
  label: 'Cash on Delivery',
  description: 'Pay in cash when your order is delivered',
  icon: 'rupee',
}

interface PaymentMethodSelectorProps {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
  /** When false (the default) the Cash on Delivery option is not rendered. */
  codEnabled?: boolean
  error?: string
}

export function PaymentMethodSelector({
  value,
  onChange,
  codEnabled = false,
  error,
}: PaymentMethodSelectorProps) {
  const methods: PaymentMethodOption[] = codEnabled
    ? [RAZORPAY_METHOD, COD_METHOD]
    : [RAZORPAY_METHOD]

  return (
    <div className="payment-methods">
      <fieldset className="payment-methods__set">
        <legend className="address-form__title">Payment method</legend>
        <div className={error ? 'payment-methods__list payment-methods__list--error' : 'payment-methods__list'}>
          {methods.map((method) => (
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
