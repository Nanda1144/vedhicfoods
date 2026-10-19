import { Input, Select } from '../common/form'
import { INDIAN_STATES, type AddressFormData } from './addressFormData'

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
            maxLength={100}
            value={value.fullName}
            onChange={(event) => onChange({ fullName: event.target.value })}
            error={errors.fullName}
            required={isRequired('fullName')}
            autoComplete="name"
          />
          <Input
            label="Mobile number"
            type="tel"
            maxLength={15}
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
          maxLength={254}
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
          maxLength={200}
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
          maxLength={200}
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
              maxLength={100}
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
