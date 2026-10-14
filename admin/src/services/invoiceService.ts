import type { Invoice } from '@/types'
import { apiFetch, type RequestOptions } from './http'

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
  ): Promise<{
    items: Invoice[]
    total: number
    page: number
    limit: number
    totalPages: number
  }> {
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

  /** Printable view for the browser. */
  print(): void {
    if (typeof window !== 'undefined') window.print()
  },
}