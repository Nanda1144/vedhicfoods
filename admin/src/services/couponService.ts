import type { AppliedCoupon, CouponValidation } from '@/types'
import { apiFetch, type RequestOptions } from './http'

/**
 * Coupon validation is decided authoritatively by the backend
 * (`POST /api/v1/coupons/validate`) against the real database prices and
 * product/category eligibility. Anonymous carts must send their line items
 * (`productId` + `quantity`) so the server can calculate the real discount.
 */
export const couponService = {
  async validate(
    code: string,
    items: Array<{ productId: string; quantity: number }>,
    options?: RequestOptions,
  ): Promise<CouponValidation> {
    try {
      const res = await apiFetch<any>(
        '/coupons/validate',
        {
          method: 'POST',
          body: JSON.stringify({ code, items }),
        },
        options,
      )

      const coupon: AppliedCoupon = {
        code: res.code,
        label: res.code,
        type: res.discountType === 'PERCENTAGE' ? 'percent' : 'flat',
        value: Number(res.discountValue),
        amount: Number(res.discountAmount),
      }

      return { valid: true, coupon }
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Coupon could not be applied.',
      }
    }
  },
}