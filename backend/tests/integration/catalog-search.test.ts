import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'

/**
 * Full-text product search (migration 20261014000000_product_full_text_search).
 *
 * The listing's free-text path runs `search_vector @@ websearch_to_tsquery(...)`
 * ranked by `ts_rank`, over a trigger-maintained `tsvector` built from
 * name + shortDescription + description + tags + sku. These are integration
 * assertions against the real generated vector, not the mocked unit test:
 *
 *   - a word living only in the name / description / tags / sku is findable;
 *   - an empty search term (`?q=`), and a missing term, fall back to the normal
 *     counted listing rather than the ranked path;
 *   - a term that matches nothing yields an empty page, not the whole catalogue;
 *   - `or` is understood (websearch semantics), so either term matches.
 */
const app = createApp()
const ts = Date.now()

// Distinctive single tokens so the assertions cannot be satisfied by the
// dev-catalogue rows already present in the database.
const NAME_TOKEN = `zephyr${ts}`
const DESC_TOKEN = `descuniq${ts}`
const TAG_TOKEN = `taguniq${ts}`
const SKU_TOKEN = `FTSKU${ts}`
const OR_A = `omegaword${ts}`
const OR_B = `sigmaword${ts}`

describe('Product full-text search (tsvector)', () => {
  let adminToken: string
  let categoryId: string

  const createdCategoryIds: string[] = []
  const createdProductIds: string[] = []

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function createProduct(body: Record<string, any>) {
    const res = await request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(body)
    if (res.status === 201 && res.body?.id) createdProductIds.push(res.body.id)
    return res
  }

  const search = async (term: string) =>
    request(app).get(`/api/v1/products?q=${encodeURIComponent(term)}&per_page=100`)

  beforeAll(async () => {
    const admin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = admin.accessToken

    const cat = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(adminToken))
      .send({ name: `Search ${ts}`, accent: '#556677' })
    expect(cat.status).toBe(201)
    categoryId = cat.body.id
    createdCategoryIds.push(categoryId)

    const base = await createProduct({
      name: `${NAME_TOKEN} Ancient Grain Mix`,
      sku: SKU_TOKEN,
      categoryId,
      price: 150,
      mrp: 200,
      stock: 20,
      shortDescription: 'Wholesome breakfast blend',
      description: `A premium blend carrying the ${DESC_TOKEN} marker for indexing.`,
      tags: [TAG_TOKEN, 'breakfast'],
    })
    expect(base.status).toBe(201)

    const orA = await createProduct({
      name: `${OR_A} Product`,
      sku: `SKU-OR-A-${ts}`,
      categoryId,
      price: 10,
      mrp: 20,
    })
    expect(orA.status).toBe(201)

    const orB = await createProduct({
      name: `${OR_B} Product`,
      sku: `SKU-OR-B-${ts}`,
      categoryId,
      price: 10,
      mrp: 20,
    })
    expect(orB.status).toBe(201)
  }, 60000)

  afterAll(async () => {
    const productIds = [...new Set(createdProductIds)]
    const categoryIds = [...new Set(createdCategoryIds)]

    if (productIds.length > 0) {
      await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    }
    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } }).catch(() => {})
    }
  })

  it('finds a product by a word in its name', async () => {
    const res = await search(NAME_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.items.some((p: any) => p.name.includes(NAME_TOKEN))).toBe(true)
  })

  it('finds a product by a word in its description', async () => {
    const res = await search(DESC_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.items.some((p: any) => p.description.includes(DESC_TOKEN))).toBe(true)
  })

  it('finds a product by one of its tags', async () => {
    const res = await search(TAG_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.items.some((p: any) => (p.tags || []).includes(TAG_TOKEN))).toBe(true)
  })

  it('finds a product by its SKU', async () => {
    const res = await search(SKU_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.items.some((p: any) => p.sku === SKU_TOKEN)).toBe(true)
  })

  it('matches either side of a websearch `or` expression', async () => {
    const res = await search(`${OR_A} or ${OR_B}`)
    expect(res.status).toBe(200)
    const names = res.body.items.map((p: any) => p.name)
    expect(names.some((n: string) => n.includes(OR_A))).toBe(true)
    expect(names.some((n: string) => n.includes(OR_B))).toBe(true)
  })

  it('returns an empty page for a term that matches nothing', async () => {
    const res = await search(`nosuchproduct${ts}xyz`)
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('falls back to the normal listing for an empty q', async () => {
    const empty = await request(app).get('/api/v1/products?q=&per_page=100')
    expect(empty.status).toBe(200)
    expect(Array.isArray(empty.body.items)).toBe(true)
    expect(empty.body.total).toBeGreaterThanOrEqual(1)

    const missing = await request(app).get('/api/v1/products?per_page=100')
    expect(missing.status).toBe(200)

    // The empty term must behave exactly like no term at all.
    expect(empty.body.total).toBe(missing.body.total)
    expect(empty.body.items.some((p: any) => p.name.includes(NAME_TOKEN))).toBe(true)
    expect(missing.body.items.some((p: any) => p.name.includes(NAME_TOKEN))).toBe(true)
  })
})
