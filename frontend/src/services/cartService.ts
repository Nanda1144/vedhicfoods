import { apiFetch, type RequestOptions } from './http'

/**
 * Server-side cart transport.
 *
 * Every call carries the guest `x-session-token` header. The backend ignores it
 * for signed-in customers (the JWT wins) and uses it as the cart identity for
 * guests, so one code path covers both — and `POST /cart/merge` can move the
 * guest basket into the account on sign-in.
 */

const SESSION_TOKEN_KEY = 'vedhic.cart.session'

let inMemorySessionToken: string | null = null

/** Stable per-browser guest identity, created on first use. */
export function getGuestSessionToken(): string {
  if (typeof window === 'undefined') return inMemorySessionToken ?? (inMemorySessionToken = 'server')

  try {
    const existing = window.localStorage.getItem(SESSION_TOKEN_KEY)
    if (existing) return existing

    const token =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    window.localStorage.setItem(SESSION_TOKEN_KEY, token)
    return token
  } catch {
    inMemorySessionToken ||= `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    return inMemorySessionToken
  }
}

function sessionHeaders(): Record<string, string> {
  return { 'x-session-token': getGuestSessionToken() }
}

export interface ServerCartInventory {
  availableQuantity: number
  status: string
  isOutOfStock: boolean
  hasInsufficientStock: boolean
  isAvailable: boolean
}

export interface ServerCartItem {
  id: string
  productId: string
  productName: string
  slug: string
  sku: string
  unit: string
  image: string
  unitPrice: number
  mrp: number
  discount: number
  quantity: number
  lineTotal: number
  lineSavings: number
  priceSnapshot: number
  priceChanged: boolean
  inventory: ServerCartInventory
}

export interface ServerCart {
  cartId: string
  userId: string | null
  sessionToken: string | null
  items: ServerCartItem[]
  itemCount: number
  totalUnits: number
  subtotal: number
  originalSubtotal: number
  savings: number
  shipping: number
  tax: number
  total: number
  currency: string
  hasStockIssues: boolean
  updatedAt: string
}

/** Result of `POST /cart/apply-coupon` (unwrapped from `{ success, data }`). */
export interface CouponEvaluation {
  isValid: boolean
  couponId: string
  code: string
  discountType: string
  discountValue: number
  discountAmount: number
  subtotal: number
  eligibleSubtotal: number
  minOrderValue: number
  maxDiscount: number | null
  message: string
  eligibleProductIds: string[]
}

export interface CartIssue {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
  reason: string
}

export const cartService = {
  get(options?: RequestOptions): Promise<ServerCart> {
    return apiFetch<ServerCart>('/cart', { method: 'GET', headers: sessionHeaders() }, options)
  },

  add(productIdOrSlug: string, quantity: number, options?: RequestOptions): Promise<ServerCart> {
    return apiFetch<ServerCart>(
      '/cart/items',
      {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({ productId: productIdOrSlug, quantity }),
      },
      options,
    )
  },

  update(itemId: string, quantity: number, options?: RequestOptions): Promise<ServerCart> {
    return apiFetch<ServerCart>(
      `/cart/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: sessionHeaders(),
        body: JSON.stringify({ quantity }),
      },
      options,
    )
  },

  remove(itemId: string, options?: RequestOptions): Promise<ServerCart> {
    return apiFetch<ServerCart>(
      `/cart/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE', headers: sessionHeaders() },
      options,
    )
  },

  clear(options?: RequestOptions): Promise<ServerCart> {
    return apiFetch<ServerCart>('/cart', { method: 'DELETE', headers: sessionHeaders() }, options)
  },

  validate(options?: RequestOptions): Promise<{ isValid: boolean; issues: CartIssue[]; cart: ServerCart }> {
    return apiFetch(
      '/cart/validate',
      { method: 'POST', headers: sessionHeaders(), body: JSON.stringify({}) },
      options,
    )
  },

  /** Folds the guest basket into the signed-in account's cart. */
  merge(options?: RequestOptions): Promise<ServerCart> {
    return apiFetch<ServerCart>(
      '/cart/merge',
      {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({ sessionToken: getGuestSessionToken() }),
      },
      options,
    )
  },

  /**
   * Authoritative coupon validation. Guests must send line items (the server
   * can only read a cart by userId); signed-in callers could omit them, but
   * sending them keeps one code path and guarantees the quote matches what the
   * customer is looking at.
   */
  applyCoupon(
    code: string,
    items: Array<{ productId: string; quantity: number }>,
    options?: RequestOptions,
  ): Promise<CouponEvaluation> {
    return apiFetch<CouponEvaluation>(
      '/cart/apply-coupon',
      {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({ code, items }),
      },
      options,
    )
  },
}
