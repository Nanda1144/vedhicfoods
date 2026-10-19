import type { StorefrontPromotion } from '@/types'
import { apiFetch, type RequestOptions } from './http'

/**
 * Public festive campaigns. The backend already limits this to published
 * promotions inside their start/end window, ordered by priority.
 */
export const promotionService = {
  async active(options?: RequestOptions): Promise<StorefrontPromotion[]> {
    return apiFetch<StorefrontPromotion[]>('/promotions/active', undefined, options)
  },
}
