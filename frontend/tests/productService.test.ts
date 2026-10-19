import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { productService } from '@/services/productService'
import { API_BASE_URL, ServiceError } from '@/services/http'

/**
 * Storefront data layer for the catalogue.
 *
 * The customer site has no static fallback: what the product pages render is
 * exactly what `productService` returns from `GET /api/v1/products`. That makes
 * the request it builds and the mapping it applies the contract an admin edit
 * travels through — a wrong path, a dropped filter or a mis-read field means the
 * admin saved the change and the storefront silently ignored it. A mocked
 * `fetch` pins both halves without a live backend.
 */

const fetchMock = vi.fn()

function respond(body: unknown, init: { ok?: boolean; status?: number } = {}): void {
  const ok = init.ok ?? true
  const status = init.status ?? (ok ? 200 : 400)
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
    json: async () => body,
  })
}

function productPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod_1',
    slug: 'ragi-flour',
    name: 'Organic Ragi Flour',
    categorySlug: 'millets',
    shortDescription: 'Stone-ground ragi.',
    description: 'Stone-ground ragi flour.',
    price: 199,
    mrp: 249,
    currency: 'INR',
    unit: '500 g',
    netWeight: 500,
    images: ['/img/ragi.webp'],
    tags: ['millet', 'gluten-free'],
    rating: 4.5,
    reviewCount: 12,
    stock: 30,
    sku: 'VF-RAGI-500',
    ingredients: ['ragi'],
    allergens: [],
    shelfLife: '6 months',
    storage: 'Cool and dry',
    nutrition: [],
    specifications: [],
    isOrganic: true,
    isBestSeller: false,
    isNew: true,
    isFeatured: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function lastUrl(): string {
  return String(fetchMock.mock.calls[0]![0])
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('productService.list', () => {
  it('requests the products endpoint with every active filter', async () => {
    respond({ items: [], total: 0, page: 1, per_page: 12 })

    await productService.list(
      {
        query: 'millet',
        categories: ['millets'],
        tags: ['Millet', 'Gluten-Free'],
        minPrice: 100,
        maxPrice: 500,
        inStockOnly: true,
        organicOnly: true,
        minRating: 4,
        sort: 'price-asc',
      },
      { page: 2, perPage: 12 },
    )

    expect(lastUrl()).toBe(
      `${API_BASE_URL}/products?page=2&per_page=12&search=millet&category_slug=millets` +
        '&min_price=100&max_price=500&available=true&is_organic=true&min_rating=4' +
        '&tags=millet%2Cgluten-free&sort=price-asc',
    )
  })

  it('omits filters that are not set', async () => {
    respond({ items: [] })

    await productService.list({}, { page: 1, perPage: 12 })

    expect(lastUrl()).toBe(`${API_BASE_URL}/products?page=1&per_page=12`)
  })

  it('omits category_slug when several categories are selected (resolved client-side)', async () => {
    respond({ items: [] })

    await productService.list({ categories: ['millets', 'grains'] })

    expect(lastUrl()).not.toContain('category_slug')
    expect(lastUrl()).not.toContain('grains')
  })

  it('maps the response items and pagination through to the caller', async () => {
    respond({
      items: [productPayload({ name: 'Admin-edited Ragi', price: 179 })],
      total: 25,
      page: 2,
      per_page: 12,
      total_pages: 3,
    })

    const result = await productService.list({}, { page: 2, perPage: 12 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.name).toBe('Admin-edited Ragi')
    expect(result.items[0]!.price).toBe(179)
    expect(result.pagination).toEqual({ page: 2, perPage: 12, total: 25, totalPages: 3 })
  })

  it('derives pagination when the backend omits it', async () => {
    respond({ items: [productPayload()] })

    const result = await productService.list({}, { page: 1, perPage: 12 })

    expect(result.pagination).toEqual({ page: 1, perPage: 12, total: 1, totalPages: 1 })
  })

  it('unwraps a { data } envelope before mapping', async () => {
    respond({ success: true, data: { items: [productPayload()], total: 1 } })

    const result = await productService.list({})

    expect(result.items[0]!.slug).toBe('ragi-flour')
  })

  it('throws instead of returning a placeholder when the payload is malformed', async () => {
    respond({ products: [] })

    await expect(productService.list({})).rejects.toThrow(/Malformed product list response/)
  })
})

describe('productService.bySlug', () => {
  it('requests the encoded slug path and returns the mapped product', async () => {
    respond(productPayload({ slug: 'ragi flour' }))

    const product = await productService.bySlug('ragi flour')

    expect(lastUrl()).toBe(`${API_BASE_URL}/products/ragi%20flour`)
    expect(product.slug).toBe('ragi flour')
    expect(product.sku).toBe('VF-RAGI-500')
  })

  it('raises a NOT_FOUND service error for a product with no slug', async () => {
    respond({ name: 'ghost' })

    await expect(productService.bySlug('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('surfaces the backend message on a failed request', async () => {
    respond({ error: 'Product is not available' }, { ok: false, status: 404 })

    const error = await productService.bySlug('gone').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServiceError)
    expect((error as ServiceError).message).toBe('Product is not available')
  })
})

describe('productService.search', () => {
  it('returns an empty list without calling the API for a blank query', async () => {
    await expect(productService.search('   ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('encodes the query and limits the result count', async () => {
    respond({ items: [productPayload()] })

    await productService.search('ragi flour', 6)

    expect(lastUrl()).toBe(`${API_BASE_URL}/products?search=ragi%20flour&per_page=6`)
  })
})

describe('productService.categories', () => {
  it('fetches the categories endpoint and returns the array', async () => {
    respond([{ id: 'cat_1', slug: 'millets', name: 'Millets' }])

    const categories = await productService.categories()

    expect(lastUrl()).toBe(`${API_BASE_URL}/categories`)
    expect(categories).toHaveLength(1)
  })
})
