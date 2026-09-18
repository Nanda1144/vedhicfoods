import { DISCOUNTS } from '@/data/admin'
import { SITE } from '@/config/site'
import type { AppliedCoupon, CouponValidation } from '@/types'
import { mockRequest, type RequestOptions } from './http'

/** Mirrors server-side coupon validation so the UI can preview discounts. */
export function evaluateCoupon(code: string, subtotal: number): CouponValidation {
  const normalised = code.trim().toUpperCase()
  if (!normalised) return { valid: false, error: 'Enter a coupon code.' }

  const discount = DISCOUNTS.find((d) => d.code === normalised)
  if (!discount) return { valid: false, error: 'That coupon code is not recognised.' }
  if (!discount.active) return { valid: false, error: 'This coupon is no longer active.' }

  const now = Date.now()
  if (now < +new Date(discount.startsAt)) {
    return { valid: false, error: 'This coupon is not active yet.' }
  }
  if (now > +new Date(discount.expiresAt)) {
    return { valid: false, error: 'This coupon has expired.' }
  }
  if (discount.usedCount >= discount.maxUses) {
    return { valid: false, error: 'This coupon has reached its usage limit.' }
  }
  if (subtotal < discount.minOrderValue) {
    return {
      valid: false,
      error: `Add ₹${(discount.minOrderValue - subtotal).toLocaleString('en-IN')} more to use ${normalised}.`,
    }
  }

  const amount =
    discount.type === 'percent'
      ? Math.round((subtotal * discount.value) / 100)
      : discount.type === 'shipping'
        ? subtotal >= SITE.freeShippingThreshold
          ? 0
          : discount.value
        : discount.value

  const coupon: AppliedCoupon = {
    code: discount.code,
    label: discount.label,
    type: discount.type,
    value: discount.value,
    amount,
  }

  return { valid: true, coupon }
}

export const couponService = {
  validate(code: string, subtotal: number, options?: RequestOptions) {
    return mockRequest(() => evaluateCoupon(code, subtotal), { delay: 420, ...options })
  },

  async available(options?: RequestOptions) {
    return mockRequest(() => DISCOUNTS.filter((d) => d.active), { delay: 220, ...options })
  },
}
