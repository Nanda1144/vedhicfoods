import type { Invoice, PaginatedInvoiceList } from '@/types'
import { apiFetch, type RequestOptions } from './http'
import { orderTokenStore } from './orderTokenStore'

/** Resolves the anonymous order token stored for this order, if any. */
function orderTokenFor(key: string): string | null {
  return orderTokenStore.get(key)
}

/**
 * Invoice access requires a session or an anonymous order-access token. Guests
 * reach invoices through the token minted at checkout; the invoice itself is
 * generated and emailed server-side after payment capture.
 */
export const invoiceService = {
  async list(options?: RequestOptions): Promise<Invoice[]> {
    const data = await apiFetch<{ invoices: Invoice[]; pagination: Record<string, unknown> }>(
      '/invoices',
      { method: 'GET' },
      options,
    )
    return data.invoices
  },

  async listPaginated(
    page: number,
    limit: number,
    options?: RequestOptions,
  ): Promise<PaginatedInvoiceList> {
    const data = await apiFetch<{
      invoices: Invoice[]
      pagination: { page: number; limit: number; total: number; totalPages: number }
    }>(
      `/invoices?page=${page}&limit=${limit}`,
      { method: 'GET' },
      options,
    )
    return {
      items: data.invoices,
      total: data.pagination.total,
      page: data.pagination.page,
      limit: data.pagination.limit,
      totalPages: data.pagination.totalPages,
    }
  },

  async byId(id: string, options?: RequestOptions): Promise<Invoice> {
    return apiFetch<Invoice>(
      `/invoices/${encodeURIComponent(id)}`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(id) },
    )
  },

  async byOrderNumber(orderNumber: string, options?: RequestOptions): Promise<Invoice> {
    return apiFetch<Invoice>(
      `/invoices/order/${orderNumber}`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(orderNumber) },
    )
  },

  async downloadUrl(id: string, options?: RequestOptions): Promise<string> {
    return apiFetch<{ downloadUrl: string }>(
      `/invoices/${id}/download`,
      { method: 'GET' },
      { ...options, orderToken: options?.orderToken ?? orderTokenFor(id) },
    ).then((data) => data.downloadUrl)
  },

  /** Printable view for the browser. */
  print(): void {
    if (typeof window !== 'undefined') window.print()
  },
}