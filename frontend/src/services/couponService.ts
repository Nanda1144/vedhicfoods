import type { AppliedCoupon, CouponValidation } from '@/types'
import { cartService, type CouponEvaluation } from './cartService'
import type { RequestOptions } from './http'

/**
 * Coupon validation is authoritative on the server (`POST /cart/apply-coupon`),
 * which re-prices every line against the catalogue and enforces eligibility,
 * minimums and usage limits. The previous build validated against a static
 * `DISCOUNTS` table in the browser — a discount the customer could see applied
 * while the backend rejected it at checkout.
 */

function toAppliedCoupon(result: CouponEvaluation): AppliedCoupon {
  return {
    code: result.code,
    label: result.code,
    type: result.discountType === 'PERCENTAGE' ? 'percent' : 'flat',
    value: Number(result.discountValue) || 0,
    amount: Number(result.discountAmount) || 0,
  }
}

export const couponService = {
  /**
   * Validates a code against the given cart lines. Returns a `CouponValidation`
   * rather than throwing, so callers can render the rejection message inline.
   */
  async validate(
    code: string,
    items: Array<{ productId: string; quantity: number }>,
    options?: RequestOptions,
  ): Promise<CouponValidation> {
    const trimmed = code.trim()
    if (!trimmed) return { valid: false, error: 'Enter a coupon code.' }
    if (items.length === 0) return { valid: false, error: 'Add something to your basket first.' }

    try {
      const result = await cartService.applyCoupon(trimmed, items, options)
      if (!result?.isValid) {
        return { valid: false, error: result?.message || 'That coupon code is not valid.' }
      }
      return { valid: true, coupon: toAppliedCoupon(result) }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'That coupon code could not be applied.'
      return { valid: false, error: message }
    }
  },
}
