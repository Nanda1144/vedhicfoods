import { PRICE_BOUNDS } from '@/data/products'
import type { Product, Category } from '@/types'
import { apiFetch, type RequestOptions } from './http'

/**
 * Admin product data source.
 *
 * Both the admin console catalog widgets and the quick-search overlay are
 * served by the backend (`GET /api/v1/products`, `/categories`). There is no
 * static fallback: a failing API surfaces as an error instead of silently
 * showing placeholder catalogue data.
 */
export const productService = {
  /** Quick search used by the nav overlay. */
  async search(query: string, limit = 6, options?: RequestOptions): Promise<Product[]> {
    const q = query.trim()
    if (!q) return []

    const res = await apiFetch<any>(
      `/products?search=${encodeURIComponent(q)}&per_page=${limit}`,
      undefined,
      options,
    )
    if (res && Array.isArray(res.items)) return res.items as Product[]
    throw new Error('Malformed search response')
  },

  async categories(options?: RequestOptions): Promise<Category[]> {
    const cats = await apiFetch<Category[]>('/categories', undefined, options)
    if (Array.isArray(cats) && cats.length > 0) return cats
    throw new Error('Malformed categories response')
  },

  /** Static facet presets for the filter UI (not product data). */
  priceBounds() {
    return PRICE_BOUNDS
  },
}