import type { Order, PaymentMethod } from '@/types'
import { normalizeOrder } from '@/utils/order'
import { apiFetch, notFound, type RequestOptions } from './http'
import { orderTokenStore } from './orderTokenStore'

/**
 * Storefront order service.
 *
 * - `place` → `POST /orders/checkout` (alias of `POST /orders`), the
 *   guest-friendly storefront adapter. Works signed-in or signed-out.
 * - Everything that *reads* an order (`GET /orders/:id`, `/orders/my-orders`,
 *   `/orders/:n/delivery`) requires a session or an anonymous order-access
 *   token returned by checkout — guests rely on that token (stored here) or on
 *   the checkout response captured at place time.
 */

/** Resolves the anonymous order token stored for this order, if any. */
function orderTokenFor(key: string): string | null {
  return orderTokenStore.get(key)
}

export interface PlaceOrderAddress {
  fullName: string
  phone: string
  line1: string
  line2?: string
  landmark?: string
  city: string
  state: string
  pincode: string
  country: string
}

export interface PlaceOrderInput {
  customerName: string
  customerEmail: string
  phone: string
  address: PlaceOrderAddress
  lines: Array<{ slug: string; productId?: string; quantity: number }>
  paymentMethod: PaymentMethod
  couponCode?: string
  notes?: string
  /**
   * Stable per-checkout-attempt key. The backend returns the existing order for
   * a repeated key instead of creating a duplicate order + inventory
   * reservation, so a retry after a flaky payment step is safe.
   */
  idempotencyKey: string
}

export interface CheckoutResult {
  success: boolean
  orderId: string
  orderNumber: string
  invoiceId?: string | null
  invoiceNumber?: string | null
  total?: number
  discount?: number
  status?: string
  paymentStatus?: string
  paymentMethod?: string
  /**
   * Present on anonymous checkout: a short-lived, order-bound JWT the guest
   * uses to initiate/verify payment and read the order + invoice.
   */
  orderToken?: string | null
  message?: string
  isIdempotentReplay?: boolean
}

export interface MyOrdersResult {
  items: Record<string, unknown>[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export const orderService = {
  async place(input: PlaceOrderInput, options?: RequestOptions): Promise<CheckoutResult> {
    const payload = {
      customerName: input.customerName.trim(),
      customerEmail: input.customerEmail.trim().toLowerCase(),
      phone: input.phone.trim(),
      address: {
        fullName: input.customerName.trim(),
        phone: input.phone.trim(),
        line1: input.address.line1.trim(),
        line2: input.address.line2?.trim() || null,
        landmark: input.address.landmark?.trim() || null,
        city: input.address.city.trim(),
        state: input.address.state.trim(),
        pincode: input.address.pincode.trim(),
        country: input.address.country || 'India',
      },
      items: input.lines.map((line) =>
        line.productId
          ? { productId: line.productId, quantity: line.quantity }
          : { slug: line.slug, quantity: line.quantity },
      ),
      paymentMethod: input.paymentMethod,
      couponCode: input.couponCode || null,
      notes: input.notes || null,
      idempotencyKey: input.idempotencyKey,
    }

    return apiFetch<CheckoutResult>(
      '/orders/checkout',
      { method: 'POST', body: JSON.stringify(payload) },
      options,
    )
  },

  /**
   * Order lookup by order number, DB id or invoice id.
   * Authenticated customers use their session; guests use the order-access
   * token from checkout. Falls back to the stored checkout payload otherwise.
   */
  async byNumber(orderNumber: string, options?: RequestOptions): Promise<Order> {
    if (!orderNumber) notFound('Order', orderNumber)
    const raw = await apiFetch<Record<string, unknown>>(
      `/orders/${encodeURIComponent(orderNumber)}`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(orderNumber) },
    )
    if (!raw || !raw.orderNumber) notFound('Order', orderNumber)
    return normalizeOrder(raw)
  },

  async myOrders(
    page = 1,
    limit = 10,
    options?: RequestOptions,
  ): Promise<{ items: Order[]; pagination: MyOrdersResult['pagination'] }> {
    const res = await apiFetch<MyOrdersResult>(
      `/orders/my-orders?page=${page}&limit=${limit}`,
      { method: 'GET' },
      options,
    )
    return {
      items: (res?.items ?? []).map((item) => normalizeOrder(item as Record<string, unknown>)),
      pagination: res?.pagination ?? { page, limit, total: 0, totalPages: 1 },
    }
  },

  /** Customer delivery tracking snapshot for their own order. */
  async delivery(orderNumber: string, options?: RequestOptions): Promise<Record<string, any>> {
    const data = await apiFetch<any>(
      `/orders/${encodeURIComponent(orderNumber)}/delivery`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(orderNumber) },
    )
    return data ?? {}
  },

  async cancel(orderId: string, reason?: string, options?: RequestOptions): Promise<{ message: string }> {
    return apiFetch(
      `/orders/${encodeURIComponent(orderId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason: reason || 'Order cancelled by customer' }) },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(orderId) },
    )
  },

  /**
   * Marks a pending online payment as failed and releases its reserved stock.
   * Called when the customer abandons/ closes the Razorpay modal, which emits no
   * gateway webhook — without this the reservation would be held indefinitely.
   */
  async failPayment(
    orderId: string,
    reason: string,
    options?: RequestOptions,
  ): Promise<{ message: string }> {
    return apiFetch(
      `/orders/${encodeURIComponent(orderId)}/fail-payment`,
      { method: 'POST', body: JSON.stringify({ reason }) },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(orderId) },
    )
  },
}