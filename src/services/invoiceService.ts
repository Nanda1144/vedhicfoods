import { INVOICES, ORDERS } from '@/data/admin'
import type { Invoice, Order } from '@/types'
import { mockRequest, notFound, type RequestOptions } from './http'
import { orderStore } from './orderStore'

/** Generates a printable invoice on the fly for a freshly placed order. */
function invoiceFromOrder(order: Order): Invoice {
  const numeric = order.orderNumber.replace(/[^\d]/g, '').slice(-5)
  return {
    id: order.invoiceId ?? `inv-${order.id}`,
    invoiceNumber: `INV/2026/${numeric}`,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    billingAddress: order.address,
    shippingAddress: order.address,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shipping: order.shipping,
    tax: order.tax,
    total: order.total,
    status: order.paymentStatus === 'paid' ? 'paid' : 'issued',
    issuedAt: order.placedAt,
    dueAt: order.placedAt,
  }
}

export const invoiceService = {
  async list(options?: RequestOptions): Promise<Invoice[]> {
    return mockRequest(() => {
      const generated = orderStore.all().map(invoiceFromOrder)
      return [...generated, ...INVOICES]
    }, options)
  },

  async byId(id: string, options?: RequestOptions): Promise<Invoice> {
    return mockRequest(() => {
      const seeded = INVOICES.find((i) => i.id === id)
      if (seeded) return seeded

      const placed = orderStore.all().find((order) => order.invoiceId === id || order.id === id)
      if (placed) return invoiceFromOrder(placed)

      notFound('Invoice', id)
    }, options)
  },

  async byOrderNumber(orderNumber: string, options?: RequestOptions): Promise<Invoice> {
    return mockRequest(() => {
      const order = orderStore.byNumber(orderNumber) ?? ORDERS.find((o) => o.orderNumber === orderNumber)
      if (!order) notFound('Order', orderNumber)

      const seeded = INVOICES.find((i) => i.id === order.invoiceId)
      if (seeded) return seeded

      return invoiceFromOrder(order)
    }, options)
  },

  /** Prototype invoice "download" is a printable view. */
  print(): void {
    if (typeof window !== 'undefined') window.print()
  },
}