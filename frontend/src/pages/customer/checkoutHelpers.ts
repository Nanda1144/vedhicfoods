import type { AddressFormData } from '@/components/checkout'

export function shortAddress(address: AddressFormData): string {
  const parts = [address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean)
  return parts.join(', ')
}