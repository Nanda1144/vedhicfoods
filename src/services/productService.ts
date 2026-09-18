import { PRODUCTS, ALL_PRODUCT_TAGS, PRICE_BOUNDS } from '@/data/products'
import { CATEGORY_BY_SLUG, CATEGORIES } from '@/data/categories'
import type { Paginated, Product, ProductFilters } from '@/types'
import { DEFAULT_PRODUCT_FILTERS } from '@/types'
import { mockRequest, notFound, type RequestOptions } from './http'

function matches(product: Product, filters: ProductFilters): boolean {
  const query = filters.query.trim().toLowerCase()
  if (query) {
    const haystack = [
      product.name,
      product.shortDescription,
      product.categorySlug,
      ...product.tags,
      ...product.ingredients,
    ]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(query)) return false
  }

  if (filters.categories.length && !filters.categories.includes(product.categorySlug)) return false
  if (filters.tags.length && !filters.tags.some((tag) => product.tags.includes(tag))) return false
  if (filters.minPrice !== null && product.price < filters.minPrice) return false
  if (filters.maxPrice !== null && product.price > filters.maxPrice) return false
  if (filters.inStockOnly && product.stock <= 0) return false
  if (filters.organicOnly && !product.isOrganic) return false
  if (filters.minRating && product.rating < filters.minRating) return false

  return true
}

function sortProducts(items: Product[], filters: ProductFilters): Product[] {
  const list = [...items]
  switch (filters.sort) {
    case 'price-asc':
      return list.sort((a, b) => a.price - b.price)
    case 'price-desc':
      return list.sort((a, b) => b.price - a.price)
    case 'rating':
      return list.sort((a, b) => b.rating - a.rating)
    case 'name-asc':
      return list.sort((a, b) => a.name.localeCompare(b.name))
    case 'newest':
      return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    case 'bestsellers':
      return list.sort((a, b) =>
        Number(b.isBestSeller) - Number(a.isBestSeller) || b.rating - a.rating,
      )
    case 'featured':
    default:
      return list.sort((a, b) => {
        const score = (p: Product) => (p.isFeatured ? 2 : 0) + (p.isBestSeller ? 1 : 0)
        return score(b) - score(a) || b.rating - a.rating
      })
  }
}

export const productService = {
  async list(
    filters: Partial<ProductFilters> = {},
    { page = 1, perPage = 12 }: { page?: number; perPage?: number } = {},
    options?: RequestOptions,
  ): Promise<Paginated<Product>> {
    const merged: ProductFilters = { ...DEFAULT_PRODUCT_FILTERS, ...filters }
    const filtered = sortProducts(PRODUCTS.filter((p) => matches(p, merged)), merged)
    const start = (page - 1) * perPage
    return mockRequest(
      () => ({
        items: filtered.slice(start, start + perPage),
        pagination: {
          page,
          perPage,
          total: filtered.length,
          totalPages: Math.max(1, Math.ceil(filtered.length / perPage)),
        },
      }),
      { delay: 320, ...options },
    )
  },

  async all(options?: RequestOptions): Promise<Product[]> {
    return mockRequest(() => PRODUCTS, options)
  },

  async featured(limit = 8, options?: RequestOptions): Promise<Product[]> {
    return mockRequest(
      () =>
        PRODUCTS.filter((p) => p.isFeatured)
          .slice()
          .sort((a, b) => b.rating - a.rating)
          .slice(0, limit),
      { delay: 280, ...options },
    )
  },

  async bestSellers(limit = 4, options?: RequestOptions): Promise<Product[]> {
    return mockRequest(() => PRODUCTS.filter((p) => p.isBestSeller).slice(0, limit), options)
  },

  async newArrivals(limit = 4, options?: RequestOptions): Promise<Product[]> {
    return mockRequest(
      () =>
        PRODUCTS.filter((p) => p.isNew)
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
          .slice(0, limit),
      options,
    )
  },

  async bySlug(slug: string, options?: RequestOptions): Promise<Product> {
    return mockRequest(() => {
      const product = PRODUCTS.find((p) => p.slug === slug)
      if (!product) notFound('Product', slug)
      return product
    }, options)
  },

  async byCategory(slug: string, limit = 4, options?: RequestOptions): Promise<Product[]> {
    return mockRequest(
      () => PRODUCTS.filter((p) => p.categorySlug === slug).slice(0, limit),
      options,
    )
  },

  async related(slug: string, limit = 4, options?: RequestOptions): Promise<Product[]> {
    return mockRequest(() => {
      const current = PRODUCTS.find((p) => p.slug === slug)
      if (!current) return []
      const sameCategory = PRODUCTS.filter(
        (p) => p.categorySlug === current.categorySlug && p.slug !== slug,
      )
      const fill = PRODUCTS.filter(
        (p) => p.categorySlug !== current.categorySlug && p.isFeatured,
      )
      return [...sameCategory, ...fill].slice(0, limit)
    }, options)
  },

  async search(query: string, limit = 6, options?: RequestOptions): Promise<Product[]> {
    const q = query.trim().toLowerCase()
    if (!q) return mockRequest(() => [], { delay: 120, ...options })
    return mockRequest(
      () =>
        PRODUCTS.filter((p) =>
          `${p.name} ${p.shortDescription} ${p.tags.join(' ')}`.toLowerCase().includes(q),
        ).slice(0, limit),
      { delay: 200, ...options },
    )
  },

  async categories(options?: RequestOptions) {
    return mockRequest(() => CATEGORIES, options)
  },

  async categoryBySlug(slug: string, options?: RequestOptions) {
    return mockRequest(() => {
      const category = CATEGORY_BY_SLUG[slug]
      if (!category) notFound('Category', slug)
      return category
    }, options)
  },

  async tags(options?: RequestOptions): Promise<string[]> {
    return mockRequest(() => ALL_PRODUCT_TAGS, { delay: 140, ...options })
  },

  priceBounds() {
    return PRICE_BOUNDS
  },

  category(slug: string) {
    return CATEGORY_BY_SLUG[slug]
  },
}
