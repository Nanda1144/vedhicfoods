import type { Address, Invoice, InvoiceStatus } from '@/types'
import { apiFetch, apiFetchBlob, type RequestOptions } from './http'
import { orderTokenStore } from './orderTokenStore'

/** Resolves the anonymous order token stored for this order, if any. */
function orderTokenFor(key: string): string | null {
  return orderTokenStore.get(key)
}

function toNumber(raw: unknown): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

function toAddress(snapshot: Record<string, unknown>, fallbackName: string, fallbackPhone: string): Address {
  return {
    id: '',
    label: 'Delivery',
    fullName: String(snapshot.fullName ?? snapshot.name ?? fallbackName ?? ''),
    phone: String(snapshot.phone ?? fallbackPhone ?? ''),
    line1: String(snapshot.line1 ?? snapshot.addressLine ?? ''),
    line2: snapshot.line2 ? String(snapshot.line2) : undefined,
    city: String(snapshot.city ?? ''),
    state: String(snapshot.state ?? ''),
    pincode: String(snapshot.pincode ?? snapshot.pinCode ?? ''),
    country: String(snapshot.country ?? 'India'),
    isDefault: false,
  }
}

/**
 * The invoice API returns the order nested under `order` (with the customer,
 * address snapshot and line items), while the storefront works with a flat
 * `Invoice`. This adapter absorbs that so invoice pages never read `undefined`.
 */
function mapInvoice(raw: Record<string, any>): Invoice {
  const order: Record<string, any> = raw?.order ?? {}
  const snapshot: Record<string, unknown> =
    order.shippingAddressSnapshot && typeof order.shippingAddressSnapshot === 'object'
      ? order.shippingAddressSnapshot
      : order.shippingAddress && typeof order.shippingAddress === 'object'
        ? order.shippingAddress
        : {}

  const address = toAddress(
    snapshot,
    String(order.customerName ?? ''),
    String(order.customerPhone ?? ''),
  )

  const items = Array.isArray(order.items)
    ? order.items.map((item: Record<string, any>) => ({
        productId: String(item.productId ?? item.id ?? ''),
        name: String(item.name ?? 'Item'),
        image: '',
        unit: String(item.unit ?? item.unitName ?? 'piece'),
        price: toNumber(item.price),
        quantity: Math.max(0, Math.round(toNumber(item.quantity))),
        sku: String(item.sku ?? ''),
      }))
    : []

  const status = String(raw?.status ?? '').toLowerCase() || 'issued'

  return {
    id: String(raw?.id ?? ''),
    invoiceNumber: String(raw?.invoiceNumber ?? ''),
    orderId: String(raw?.orderId ?? order.id ?? ''),
    orderNumber: String(order.orderNumber ?? ''),
    customerName: String(order.customerName ?? ''),
    customerEmail: String(order.customerEmail ?? ''),
    billingAddress: address,
    shippingAddress: address,
    items,
    subtotal: toNumber(raw?.subtotal),
    discount: toNumber(raw?.discount),
    shipping: toNumber(raw?.shipping),
    tax: toNumber(raw?.tax),
    total: toNumber(raw?.total),
    status: status as InvoiceStatus,
    issuedAt: String(raw?.invoiceDate ?? raw?.createdAt ?? ''),
    dueAt: String(raw?.dueAt ?? ''),
    gstin: raw?.gstin ? String(raw.gstin) : undefined,
    notes: raw?.notes ? String(raw.notes) : undefined,
  }
}

/**
 * Invoice access requires a session or an anonymous order-access token. Guests
 * reach invoices through the token minted at checkout; the invoice itself is
 * generated and emailed server-side after payment capture.
 */
export const invoiceService = {
  async list(options?: RequestOptions): Promise<Invoice[]> {
    const data = await apiFetch<Record<string, any>[]>('/invoices', { method: 'GET' }, options)
    return Array.isArray(data) ? data.map(mapInvoice) : []
  },

  async byId(id: string, options?: RequestOptions): Promise<Invoice> {
    const data = await apiFetch<Record<string, any>>(
      `/invoices/${encodeURIComponent(id)}`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(id) },
    )
    return mapInvoice(data)
  },

  async byOrderNumber(orderNumber: string, options?: RequestOptions): Promise<Invoice> {
    const data = await apiFetch<Record<string, any>>(
      `/invoices/order/${orderNumber}`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(orderNumber) },
    )
    return mapInvoice(data)
  },

  async downloadUrl(id: string, options?: RequestOptions): Promise<string> {
    return apiFetch<{ downloadUrl: string }>(
      `/invoices/${id}/download`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(id) },
    ).then((data) => data.downloadUrl)
  },

  /**
   * Streams the invoice PDF through the API as a blob.
   *
   * Preferred over `downloadUrl` for in-app downloads: it does not depend on
   * object storage, so a missing bucket never renders as a raw S3 error page.
   */
  async fetchPdf(id: string, options?: RequestOptions): Promise<Blob> {
    return apiFetchBlob(
      `/invoices/${encodeURIComponent(id)}/pdf`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(id) },
    )
  },

  /** Printable view for the browser. */
  print(): void {
    if (typeof window !== 'undefined') window.print()
  },
}
