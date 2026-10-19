import type { Invoice } from '@/types'
import { apiFetch, apiFetchBlob, apiFetchRaw, type RequestOptions } from './http'

interface InvoiceListEnvelope {
  data?: Invoice[]
  pagination?: { page?: number; limit?: number; total?: number; totalPages?: number }
}

export const invoiceService = {
  async list(options?: RequestOptions): Promise<Invoice[]> {
    // The API returns `{ success, data, pagination }`; `apiFetch` would unwrap
    // `data` and discard `pagination`, but the previous code also read
    // `data.invoices`, which never exists. Read the raw envelope instead.
    const body = await apiFetchRaw<InvoiceListEnvelope>('/invoices', { method: 'GET' }, options)
    return Array.isArray(body?.data) ? body.data : []
  },

  async listPaginated(
    page: number,
    limit: number,
    options?: RequestOptions,
  ): Promise<{
    items: Invoice[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
    const body = await apiFetchRaw<InvoiceListEnvelope>(
      `/invoices?page=${page}&limit=${limit}`,
      { method: 'GET' },
      options,
    )
    const items = Array.isArray(body?.data) ? body.data : []
    const pagination = body?.pagination ?? {}
    const resolvedLimit = pagination.limit ?? limit
    const total = pagination.total ?? items.length
    return {
      items,
      total,
      page: pagination.page ?? page,
      limit: resolvedLimit,
      totalPages: pagination.totalPages ?? Math.ceil(total / Math.max(1, resolvedLimit)),
    }
  },

  async byId(id: string, options?: RequestOptions): Promise<Invoice> {
    return apiFetch<Invoice>(`/invoices/${encodeURIComponent(id)}`, { method: 'GET' }, options)
  },

  async byOrderNumber(orderNumber: string, options?: RequestOptions): Promise<Invoice> {
    return apiFetch<Invoice>(`/invoices/order/${encodeURIComponent(orderNumber)}`, { method: 'GET' }, options)
  },

  /**
   * Requests a short-lived signed URL for the generated PDF.
   */
  async downloadUrl(
    id: string,
    options?: RequestOptions,
  ): Promise<{ downloadUrl: string; expiresIn: number; filename: string }> {
    return apiFetch<{ downloadUrl: string; expiresIn: number; filename: string }>(
      `/invoices/${encodeURIComponent(id)}/download`,
      undefined,
      options,
    )
  },

  /**
   * Streams the invoice PDF through the API as a blob.
   *
   * Preferred over `downloadUrl`: it does not depend on object storage, so
   * viewing/downloading an invoice never lands on a raw S3 error page when the
   * bucket is missing (the development default).
   */
  async fetchPdf(id: string, options?: RequestOptions): Promise<Blob> {
    return apiFetchBlob(`/invoices/${encodeURIComponent(id)}/pdf`, { method: 'GET' }, options)
  },

  /** Printable view for the browser. */
  print(): void {
    if (typeof window !== 'undefined') window.print()
  },
}