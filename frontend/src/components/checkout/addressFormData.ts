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

/**
 * Maximum lengths mirrored from the backend address schema. Validating them on
 * the client turns a late server rejection at the final Pay step into an inline,
 * friendly error next to the offending field.
 */
export const maxLengths = {
  fullName: 100,
  line1: 200,
  city: 100,
  state: 100,
  pincode: 6,
} as const

function maxLength(value: string, max: number, label: string): ValidationResult {
  return value.length <= max
    ? { valid: true }
    : { valid: false, error: `${label} must be ${max} characters or fewer.` }
}

export function validateAddressFields(
  value: AddressFormData,
  options: { requireEmail?: boolean } = {},
): Partial<Record<keyof AddressFormData, string>> {
  const errors: Partial<Record<keyof AddressFormData, string>> = {}
  const set = (key: keyof AddressFormData, result: ValidationResult) => {
    if (!result.valid) errors[key] = result.error
  }

  set('fullName', validate(required(value.fullName, 'Full name'), maxLength(value.fullName, maxLengths.fullName, 'Full name')))
  set('phone', validate(required(value.phone, 'Mobile number'), isPhoneIN(value.phone)))
  set('line1', validate(required(value.line1, 'Address line 1'), maxLength(value.line1, maxLengths.line1, 'Address line 1')))
  set('pincode', validate(required(value.pincode, 'PIN code'), isPincode(value.pincode)))
  set('city', validate(required(value.city, 'City'), maxLength(value.city, maxLengths.city, 'City')))
  set('state', validate(required(value.state, 'State'), maxLength(value.state, maxLengths.state, 'State')))
  if (options.requireEmail) set('email', validate(required(value.email, 'Email'), isEmail(value.email)))

  return errors
}
