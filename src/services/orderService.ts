import { ORDERS, computeTotals } from '@/data/admin'
import { PRODUCT_BY_SLUG } from '@/data/products'
import type { Address, Order, OrderLineItem, PaymentMethod } from '@/types'
import { mockRequest, notFound, ServiceError, type RequestOptions } from './http'
import { orderStore } from './orderStore'

export interface PlaceOrderInput {
  customerName: string
  customerEmail: string
  phone: string
  address: Address
  lines: Array<{ slug: string; quantity: number }>
  paymentMethod: PaymentMethod
  couponCode?: string
  discount?: number
  notes?: string
}

/**
 * In production this calls POST /orders which:
 *  1. re-prices the cart server-side
 *  2. creates a Razorpay order
 *  3. returns the order + gateway params
 * The prototype mirrors that contract exactly and registers the returned
 * order locally (orderStore) so post-order pages can resolve it.
 */
export const orderService = {
  async place(input: PlaceOrderInput, options?: RequestOptions): Promise<Order> {
    const lines: OrderLineItem[] = input.lines.map(({ slug, quantity }) => {
      const product = PRODUCT_BY_SLUG[slug]
      if (!product) throw new ServiceError('INVALID_ITEM', `“${slug}” is no longer available.`)
      return {
        productId: product.id,
        name: product.name,
        image: product.images[0]!,
        unit: product.unit,
        price: product.price,
        quantity,
        sku: product.sku,
      }
    })

    if (!lines.length) throw new ServiceError('EMPTY_CART', 'Your cart is empty.')

    const totals = computeTotals(lines, input.discount ?? 0)
    const placedAt = new Date()
    const order: Order = {
      id: `ord-${Math.random().toString(36).slice(2, 8)}`,
      orderNumber: `VF-2026-${String(Math.floor(10000 + Math.random() * 89999))}`,
      customerId: `cus-guest-${Math.random().toString(36).slice(2, 6)}`,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      items: lines,
      subtotal: totals.subtotal,
      savings: totals.savings,
      shipping: totals.shipping,
      tax: totals.tax,
      discount: totals.discount,
      total: totals.total,
      status: 'confirmed',
      paymentStatus: input.paymentMethod === 'cod' ? 'pending' : 'paid',
      paymentMethod: input.paymentMethod,
      address: input.address,
      couponCode: input.couponCode,
      timeline: [
        { status: 'placed', label: 'Order placed', completed: true, at: placedAt.toISOString() },
        { status: 'confirmed', label: 'Order confirmed', completed: true, at: placedAt.toISOString(), note: 'We will dispatch within 48 hours' },
        { status: 'packed', label: 'Packed', completed: false, at: '' },
        { status: 'shipped', label: 'Shipped', completed: false, at: '' },
        { status: 'delivered', label: 'Delivered', completed: false, at: '' },
      ],
      placedAt: placedAt.toISOString(),
      updatedAt: placedAt.toISOString(),
      invoiceId: `inv-${Math.random().toString(36).slice(2, 8)}`,
      notes: input.notes,
    }

    return mockRequest(() => order, { delay: 900, ...options }).then((placed) => {
      orderStore.save(placed)
      return placed
    })
  },

  async list(options?: RequestOptions): Promise<Order[]> {
    return mockRequest(() => [...orderStore.all(), ...ORDERS], options)
  },

  async byNumber(orderNumber: string, options?: RequestOptions): Promise<Order> {
    return mockRequest(() => {
      const order = orderStore.byNumber(orderNumber) ?? ORDERS.find((o) => o.orderNumber === orderNumber)
      if (!order) notFound('Order', orderNumber)
      return order
    }, options)
  },

  async byId(id: string, options?: RequestOptions): Promise<Order> {
    return mockRequest(() => {
      const order = orderStore.byId(id) ?? ORDERS.find((o) => o.id === id)
      if (!order) notFound('Order', id)
      return order
    }, options)
  },

  stockFor(slug: string): number {
    return PRODUCT_BY_SLUG[slug]?.stock ?? 0
  },
}