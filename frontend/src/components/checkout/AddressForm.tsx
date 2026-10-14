import { Input, Select } from '../common/form'
import { isEmail, isPhoneIN, isPincode, required, validate } from '@/utils/validators'
import type { ValidationResult } from '@/utils/validators'

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const

export interface AddressFormData {
  fullName: string
  email: string
  phone: string
  line1: string
  line2: string
  pincode: string
  city: string
  state: string
}

export function emptyAddress(): AddressFormData {
  return { fullName: '', email: '', phone: '', line1: '', line2: '', pincode: '', city: '', state: '' }
}

export function validateAddressFields(
  value: AddressFormData,
  options: { requireEmail?: boolean } = {},
): Partial<Record<keyof AddressFormData, string>> {
  const errors: Partial<Record<keyof AddressFormData, string>> = {}
  const set = (key: keyof AddressFormData, result: ValidationResult) => {
    if (!result.valid) errors[key] = result.error
  }

  set('fullName', validate(required(value.fullName, 'Full name')))
  set('phone', validate(required(value.phone, 'Mobile number'), isPhoneIN(value.phone)))
  set('line1', validate(required(value.line1, 'Address line 1')))
  set('pincode', validate(required(value.pincode, 'PIN code'), isPincode(value.pincode)))
  set('city', validate(required(value.city, 'City')))
  set('state', validate(required(value.state, 'State')))
  if (options.requireEmail) set('email', validate(required(value.email, 'Email'), isEmail(value.email)))

  return errors
}

interface AddressFormProps {
  value: AddressFormData
  onChange: (patch: Partial<AddressFormData>) => void
  errors?: Partial<Record<keyof AddressFormData, string>>
  title?: string
  requiredFields?: Array<keyof AddressFormData> | 'all'
  /** Render only the given fields. Defaults to all fields. */
  fields?: Array<keyof AddressFormData>
}

export function AddressForm({ value, onChange, errors = {}, title, requiredFields = 'all', fields }: AddressFormProps) {
  const isRequired = (key: keyof AddressFormData) =>
    requiredFields === 'all' || requiredFields.includes(key)

  const show = (key: keyof AddressFormData) => !fields || fields.includes(key)

  return (
    <div className="address-form">
      {title && <h3 className="address-form__title">{title}</h3>}
      {show('fullName') && show('phone') && (
        <div className="grid grid--2">
          <Input
            label="Full name"
            value={value.fullName}
            onChange={(event) => onChange({ fullName: event.target.value })}
            error={errors.fullName}
            required={isRequired('fullName')}
            autoComplete="name"
          />
          <Input
            label="Mobile number"
            type="tel"
            placeholder="10-digit mobile"
            value={value.phone}
            onChange={(event) => onChange({ phone: event.target.value })}
            error={errors.phone}
            required={isRequired('phone')}
            autoComplete="tel"
          />
        </div>
      )}
      {show('email') && (
        <Input
          label="Email address"
          type="email"
          value={value.email}
          onChange={(event) => onChange({ email: event.target.value })}
          error={errors.email}
          required={isRequired('email')}
          autoComplete="email"
        />
      )}
      {show('line1') && (
        <Input
          label="Flat, house no., building, street"
          value={value.line1}
          onChange={(event) => onChange({ line1: event.target.value })}
          error={errors.line1}
          required={isRequired('line1')}
          autoComplete="address-line1"
        />
      )}
      {show('line2') && (
        <Input
          label="Area, landmark (optional)"
          value={value.line2}
          onChange={(event) => onChange({ line2: event.target.value })}
          autoComplete="address-line2"
        />
      )}
      {(show('city') || show('state') || show('pincode')) && (
        <div className="grid grid--3">
          {show('city') && (
            <Input
              label="City"
              value={value.city}
              onChange={(event) => onChange({ city: event.target.value })}
              error={errors.city}
              required={isRequired('city')}
              autoComplete="address-level2"
            />
          )}
          {show('state') && (
            <Select
              label="State"
              value={value.state}
              onChange={(event) => onChange({ state: event.target.value })}
              error={errors.state}
              required={isRequired('state')}
              options={INDIAN_STATES.map((state) => ({ label: state, value: state }))}
              placeholder="Select state"
            />
          )}
          {show('pincode') && (
            <Input
              label="PIN code"
              inputMode="numeric"
              maxLength={6}
              value={value.pincode}
              onChange={(event) => onChange({ pincode: event.target.value.replace(/\D/g, '').slice(0, 6) })}
              error={errors.pincode}
              required={isRequired('pincode')}
              autoComplete="postal-code"
            />
          )}
        </div>
      )}
    </div>
  )
}