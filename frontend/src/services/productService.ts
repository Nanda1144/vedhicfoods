import { PRICE_BOUNDS } from '@/data/products'
import { CATEGORY_BY_SLUG } from '@/data/categories'
import type { Paginated, Product, ProductFilters, Category } from '@/types'
import { notFound, apiFetch, type RequestOptions } from './http'

/**
 * Product catalog data source — served exclusively by the backend
 * (`GET /api/v1/products`). A failure surfaces as an error on the page; there
 * is deliberately no static fallback that could disguise a broken API as a
 * working storefront.
 */
function buildProductParams(filters: Partial<ProductFilters>, page: number, perPage: number): URLSearchParams {
  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('per_page', String(perPage))

  if (filters.query) params.set('search', filters.query.trim())

  // The backend filters a single category at a time (`category_slug`). Selecting
  // several categories is resolved client-side after fetching each one, so the
  // request count stays bounded instead of fanning out per category.
  if (filters.categories?.length === 1) params.set('category_slug', filters.categories[0]!)

  if (filters.minPrice !== null && filters.minPrice !== undefined) {
    params.set('min_price', String(filters.minPrice))
  }
  if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
    params.set('max_price', String(filters.maxPrice))
  }

  if (filters.inStockOnly) params.set('available', 'true')
  if (filters.organicOnly) params.set('is_organic', 'true')
  if (filters.minRating) params.set('min_rating', String(filters.minRating))

  // Sent as a single comma-separated value and applied with AND server-side.
  if (filters.tags?.length) params.set('tags', filters.tags.join(',').toLowerCase())

  if (filters.sort) params.set('sort', filters.sort)

  return params
}

function normalizePagination(res: any, page: number, perPage: number, itemCount: number) {
  const total = res.total ?? itemCount
  return {
    page: res.page || page,
    perPage: res.per_page || perPage,
    total,
    totalPages: res.total_pages || Math.max(1, Math.ceil(total / perPage)),
  }
}

export const productService = {
  async list(
    filters: Partial<ProductFilters> = {},
    { page = 1, perPage = 12 }: { page?: number; perPage?: number } = {},
    options?: RequestOptions,
  ): Promise<Paginated<Product>> {
    const params = buildProductParams(filters, page, perPage)

    const res = await apiFetch<any>(`/products?${params.toString()}`, undefined, options)
    if (res && Array.isArray(res.items)) {
      return { items: res.items as Product[], pagination: normalizePagination(res, page, perPage, res.items.length) }
    }
    throw new Error('Malformed product list response: expected an `items` array')
  },

  async all(options?: RequestOptions): Promise<Product[]> {
    const res = await apiFetch<any>('/products?per_page=100', undefined, options)
    if (res && Array.isArray(res.items)) return res.items as Product[]
    throw new Error('Malformed product response: expected an `items` array')
  },

  /** Featured shelf. Was previously `is_featured=true`, which the backend ignored. */
  async featured(limit = 8, options?: RequestOptions): Promise<Product[]> {
    const res = await apiFetch<any>(`/products?featured=true&per_page=${limit}`, undefined, options)
    if (res && Array.isArray(res.items)) return res.items as Product[]
    throw new Error('Malformed featured products response')
  },

  /** Previously static-only; now served from the `isBestSeller` column. */
  async bestSellers(limit = 4, options?: RequestOptions): Promise<Product[]> {
    const res = await apiFetch<any>(
      `/products?best_seller=true&sort=bestsellers&per_page=${limit}`,
      undefined,
      options,
    )
    if (res && Array.isArray(res.items)) return res.items as Product[]
    throw new Error('Malformed best sellers response')
  },

  /** Previously static-only; now served from the `isNew` column. */
  async newArrivals(limit = 4, options?: RequestOptions): Promise<Product[]> {
    const res = await apiFetch<any>(`/products?is_new=true&sort=newest&per_page=${limit}`, undefined, options)
    if (res && Array.isArray(res.items)) return res.items as Product[]
    throw new Error('Malformed new arrivals response')
  },

  /**
   * Single product by slug or id. Returns a backend 404/network error so the
   * page can show a real error state instead of a placeholder product.
   */
  async bySlug(slug: string, options?: RequestOptions): Promise<Product> {
    const product = await apiFetch<Product>(`/products/${encodeURIComponent(slug)}`, undefined, options)
    if (!product || !product.slug) {
      notFound('Product', slug)
    }
    return product
  },

  async byCategory(slug: string, limit = 4, options?: RequestOptions): Promise<Product[]> {
    const res = await apiFetch<any>(
      `/products?category_slug=${encodeURIComponent(slug)}&per_page=${limit}`,
      undefined,
      options,
    )
    if (res && Array.isArray(res.items)) return res.items as Product[]
    throw new Error('Malformed category products response')
  },

  /**
   * Related products.
   *
   * The backend has no dedicated related-products endpoint, so this derives them
   * from the product's own category: same category first, then other featured
   * products to fill the shelf.
   */
  async related(slug: string, limit = 4, options?: RequestOptions): Promise<Product[]> {
    const current = await apiFetch<Product>(`/products/${encodeURIComponent(slug)}`, undefined, options)
    return this.relatedFor(current, limit, options)
  },

  /** Builds the related shelf from a product already loaded by its detail page. */
  async relatedFor(current: Product, limit = 4, options?: RequestOptions): Promise<Product[]> {
    const slug = current.slug
    const categorySlug = current?.categorySlug
    if (!categorySlug) return []

    const res = await apiFetch<any>(
      `/products?category_slug=${encodeURIComponent(categorySlug)}&per_page=${limit + 1}`,
      undefined,
      options,
    )
    if (!res || !Array.isArray(res.items)) throw new Error('Malformed related products response')

    const sameCategory = res.items.filter((p: Product) => p.slug !== slug).slice(0, limit)
    if (sameCategory.length >= limit) return sameCategory

    // Top up from featured products so a sparse category still fills the shelf.
    const filler = await apiFetch<any>(`/products?featured=true&per_page=${limit * 2}`, undefined, options)
    const seen = new Set([slug, ...sameCategory.map((p: Product) => p.slug)])
    const extra = (filler?.items ?? [])
      .filter((p: Product) => !seen.has(p.slug))
      .slice(0, limit - sameCategory.length)

    return [...sameCategory, ...extra]
  },

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
    if (Array.isArray(cats)) return cats
    throw new Error('Malformed categories response')
  },

  async categoryBySlug(slug: string, options?: RequestOptions): Promise<Category> {
    const category = await apiFetch<Category>(`/categories/${encodeURIComponent(slug)}`, undefined, options)
    if (!category || !category.slug) notFound('Category', slug)
    return category
  },

  /**
   * Tag facets for the filter UI.
   *
   * The backend exposes no aggregate facets endpoint, so the union of tags is
   * derived from a single bounded catalogue fetch rather than N per-product
   * requests. A dedicated `/products/facets` endpoint is the proper fix at scale.
   */
  async tags(options?: RequestOptions): Promise<string[]> {
    const res = await apiFetch<any>('/products?per_page=100', undefined, options)
    if (res && Array.isArray(res.items)) {
      const tags = new Set<string>()
      for (const p of res.items as Product[]) {
        for (const tag of p.tags ?? []) tags.add(tag)
      }
      return [...tags].sort()
    }
    throw new Error('Malformed tags response')
  },

  /** Static facet presets for the filter UI (not product data). */
  priceBounds() {
    return PRICE_BOUNDS
  },

  category(slug: string) {
    return CATEGORY_BY_SLUG[slug]
  },
}
