import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Product listing: full-text search path.
 *
 * The search filter moved from an OR of `contains` predicates to PostgreSQL
 * full-text search (`search_vector` + `ts_rank`). These tests are DB-free — the
 * Prisma client is mocked — and pin the two branches:
 *
 *   - with no search term the normal counted listing is used (behaviour is
 *     unchanged, in particular for an empty string);
 *   - with a search term the ranked `$queryRaw` is used and the page is returned
 *     in relevance order regardless of the order Prisma returns rows in.
 *
 * The generated column itself can only be exercised against a real PostgreSQL,
 * which the integration suite covers.
 */
const { prismaMock } = vi.hoisted(() => {
  const mock: any = {
    product: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prismaMock: mock }
})

vi.mock('../../src/config/database', () => ({ prisma: prismaMock }))

vi.mock('../../src/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env')
  return {
    ...actual,
    env: { ...actual.env, NODE_ENV: 'test', REDIS_URL: '' },
  }
})

import { ProductService } from '../../src/services/product.service'

function productRow(id: string) {
  return {
    id,
    slug: id,
    name: `Product ${id}`,
    categoryId: 'cat_1',
    price: 100,
    mrp: 120,
    discount: 20,
    stock: 5,
    isActive: true,
    status: 'PUBLISHED',
    images: [],
    tags: [],
    rating: 4.8,
    reviewCount: 0,
    category: { id: 'cat_1', name: 'Cat', slug: 'cat' },
    inventory: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ProductService.listProducts full-text search', () => {
  it('uses the normal counted listing when no search term is supplied', async () => {
    prismaMock.product.count.mockResolvedValue(0)
    prismaMock.product.findMany.mockResolvedValue([])

    const result = await ProductService.listProducts({ page: 1, limit: 20 } as any, false)

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.product.count).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ total: 0, items: [] })
  })

  it('treats an empty search string as no search at all', async () => {
    prismaMock.product.count.mockResolvedValue(0)
    prismaMock.product.findMany.mockResolvedValue([])

    await ProductService.listProducts({ page: 1, limit: 20, q: '' } as any, false)

    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.product.count).toHaveBeenCalledTimes(1)
  })

  it('uses the ranked full-text query and preserves relevance order', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'p2' }, { id: 'p1' }])
    prismaMock.product.findMany.mockImplementation(async (args: any) => {
      // First call applies the non-search filters and returns only ids.
      if (args?.select?.id) {
        return [{ id: 'p1' }, { id: 'p2' }]
      }
      // Second call materialises the page rows in arbitrary database order.
      return [productRow('p1'), productRow('p2')]
    })

    const result = await ProductService.listProducts({ page: 1, limit: 20, q: 'ghee' } as any, false)

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    const rawArgs = prismaMock.$queryRaw.mock.calls[0]
    expect(rawArgs).toContain('ghee')

    expect(result.total).toBe(2)
    expect(result.items.map((item: any) => item.id)).toEqual(['p2', 'p1'])
  })

  it('returns an empty page when the search matches nothing', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])

    const result = await ProductService.listProducts({ page: 1, limit: 20, q: 'zzzz' } as any, false)

    expect(result.items).toEqual([])
    expect(result.total).toBe(0)
    expect(prismaMock.product.findMany).not.toHaveBeenCalled()
  })
})
