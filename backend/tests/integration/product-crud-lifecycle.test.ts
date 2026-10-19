import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'

/**
 * Product CRUD lifecycle, end to end.
 *
 * Every step asserts three things that must agree:
 *
 *   1. the HTTP response (status + payload),
 *   2. the persisted PostgreSQL row (including the linked `inventories` row),
 *   3. what the unauthenticated storefront can actually see.
 *
 * The test database is shared and never truncated, so every fixture uses a
 * run-unique slug/SKU and is deleted in `afterAll`. Public visibility is always
 * asserted through a category-scoped listing rather than the global first page,
 * so the result does not depend on how much noise the rest of the suite (or the
 * seeded dev catalogue) has created.
 */
const app = createApp()
const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

type ProductId = string

describe('Product CRUD lifecycle against the real API and database', () => {
  let adminToken: string
  let categoryA: string
  let categoryB: string

  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function createCategory(name: string, extra: Record<string, any> = {}) {
    const res = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(adminToken))
      .send({ name, accent: '#123456', ...extra })
    if (res.status === 201 && res.body?.id) createdCategoryIds.push(res.body.id)
    return res
  }

  async function createProduct(body: Record<string, any>) {
    const res = await request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(body)
    if (res.status === 201 && res.body?.id) createdProductIds.push(res.body.id)
    return res
  }

  async function patchProduct(id: ProductId, body: Record<string, any>) {
    return request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send(body)
  }

  /** The public storefront listing narrowed to a single category. */
  async function listingForCategory(categoryId: string) {
    const res = await request(app).get(`/api/v1/products?category=${categoryId}&per_page=100`)
    expect(res.status).toBe(200)
    return res.body.items as any[]
  }

  beforeAll(async () => {
    const admin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = admin.accessToken

    const a = await createCategory(`CRUD Cat A ${ts}`)
    expect(a.status).toBe(201)
    categoryA = a.body.id

    const b = await createCategory(`CRUD Cat B ${ts}`)
    expect(b.status).toBe(201)
    categoryB = b.body.id
  }, 60000)

  afterAll(async () => {
    const productIds = [...new Set(createdProductIds)]
    const categoryIds = [...new Set(createdCategoryIds)]
    if (productIds.length > 0) {
      await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.couponProduct.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.promotionProduct.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    }
    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } }).catch(() => {})
    }
  })

  // =========================================================================
  // CREATE
  // =========================================================================
  describe('Create', () => {
    it('persists the row + inventory and exposes the product on the storefront', async () => {
      const sku = `SKU-CRUD-CREATE-${ts}`
      const res = await createProduct({
        name: `CRUD Create ${ts}`,
        sku,
        categoryId: categoryA,
        description: 'Original description',
        shortDescription: 'Original short',
        price: 200,
        mrp: 300,
        stock: 12,
        unit: '500 g',
        tags: ['lifecycle'],
        ingredients: ['Millet'],
        nutrition: [{ label: 'Protein', value: '7 g' }],
        images: ['https://media.example.com/lc-1.png', 'https://media.example.com/lc-2.png'],
      })

      expect(res.status).toBe(201)
      const { id, slug } = res.body
      expect(id).toBeTruthy()
      expect(slug).toBeTruthy()
      // discount is derived from mrp - price when not supplied.
      expect(res.body.discount).toBe(100)

      const row = await prisma.product.findUnique({ where: { id }, include: { inventory: true } })
      expect(row).not.toBeNull()
      expect(row!.sku).toBe(sku)
      expect(row!.name).toBe(`CRUD Create ${ts}`)
      expect(row!.categoryId).toBe(categoryA)
      expect(Number(row!.price)).toBe(200)
      expect(Number(row!.mrp)).toBe(300)
      expect(Number(row!.discount)).toBe(100)
      expect(row!.stock).toBe(12)
      expect(row!.status).toBe('PUBLISHED')
      expect(row!.isActive).toBe(true)
      expect(row!.isDeleted).toBe(false)
      expect(row!.inventory?.availableQuantity).toBe(12)
      expect(row!.inventory?.status).toBe('IN_STOCK')

      const publicById = await request(app).get(`/api/v1/products/${id}`)
      expect(publicById.status).toBe(200)
      expect(publicById.body.id).toBe(id)
      expect(publicById.body.name).toBe(`CRUD Create ${ts}`)
      expect(publicById.body.price).toBe(200)
      expect(publicById.body.discount).toBe(100)
      expect(publicById.body.stock).toBe(12)
      expect(publicById.body.images).toEqual([
        'https://media.example.com/lc-1.png',
        'https://media.example.com/lc-2.png',
      ])

      const publicBySlug = await request(app).get(`/api/v1/products/slug/${slug}`)
      expect(publicBySlug.status).toBe(200)
      expect(publicBySlug.body.id).toBe(id)

      const items = await listingForCategory(categoryA)
      expect(items.some((p) => p.id === id)).toBe(true)
    })
  })

  // =========================================================================
  // READ
  // =========================================================================
  describe('Read', () => {
    it('returns internals to the admin but strips them from the public payload', async () => {
      const created = await createProduct({
        name: `CRUD Read ${ts}`,
        sku: `SKU-CRUD-READ-${ts}`,
        categoryId: categoryA,
        price: 100,
        mrp: 140,
        stock: 5,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const adminRead = await request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(adminRead.status).toBe(200)
      expect(adminRead.body.id).toBe(id)
      expect(adminRead.body).toHaveProperty('inventory')
      expect(adminRead.body.isDeleted).toBe(false)

      const publicRead = await request(app).get(`/api/v1/products/${id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.id).toBe(id)
      expect(publicRead.body).not.toHaveProperty('inventory')
      expect(publicRead.body).not.toHaveProperty('s3Key')
    })
  })

  // =========================================================================
  // UPDATE (partial + full)
  // =========================================================================
  describe('Update', () => {
    it('partially updates a product and reflects it immediately in DB and storefront', async () => {
      const created = await createProduct({
        name: `CRUD Update ${ts}`,
        sku: `SKU-CRUD-UPD-${ts}`,
        categoryId: categoryA,
        price: 200,
        mrp: 300,
        stock: 12,
        description: 'Before',
      })
      expect(created.status).toBe(201)
      const id = created.body.id
      const originalSlug = created.body.slug

      const updated = await patchProduct(id, {
        name: `CRUD Update Renamed ${ts}`,
        price: 150,
        stock: 30,
        description: 'After',
      })
      expect(updated.status).toBe(200)
      expect(updated.body.name).toBe(`CRUD Update Renamed ${ts}`)
      expect(updated.body.price).toBe(150)
      // Discount recomputed because the price moved (mrp 300 - price 150).
      expect(updated.body.discount).toBe(150)
      expect(updated.body.stock).toBe(30)
      // Renaming does not silently regenerate the slug.
      expect(updated.body.slug).toBe(originalSlug)

      const row = await prisma.product.findUnique({ where: { id }, include: { inventory: true } })
      expect(row!.name).toBe(`CRUD Update Renamed ${ts}`)
      expect(Number(row!.price)).toBe(150)
      expect(Number(row!.discount)).toBe(150)
      expect(row!.stock).toBe(30)
      expect(row!.inventory?.availableQuantity).toBe(30)
      expect(row!.inventory?.status).toBe('IN_STOCK')

      const publicRead = await request(app).get(`/api/v1/products/${id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.name).toBe(`CRUD Update Renamed ${ts}`)
      expect(publicRead.body.description).toBe('After')
      expect(publicRead.body.price).toBe(150)
      expect(publicRead.body.stock).toBe(30)
    })

    it('fully updates a product via PUT and reflects it in DB and storefront', async () => {
      const created = await createProduct({
        name: `CRUD Put ${ts}`,
        sku: `SKU-CRUD-PUT-${ts}`,
        categoryId: categoryA,
        price: 100,
        mrp: 120,
        stock: 3,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const res = await request(app)
        .put(`/api/v1/admin/products/${id}`)
        .set(auth(adminToken))
        .send({
          name: `CRUD Put Full ${ts}`,
          sku: `SKU-CRUD-PUT-FULL-${ts}`,
          categoryId: categoryB,
          shortDescription: 'Full short',
          description: 'Full description',
          price: 250,
          mrp: 400,
          // Explicit discount that differs from mrp - price (150) must be kept.
          discount: 125,
          stock: 40,
          unit: '1 kg',
          netWeight: 1000,
          tags: ['full', 'update'],
          ingredients: ['Ragi'],
          allergens: ['None'],
          nutrition: [{ label: 'Energy', value: '350 kcal' }],
          shelfLife: '9 Months',
          storage: 'Cool and dry',
          isOrganic: true,
          isNew: true,
          isActive: true,
          status: 'PUBLISHED',
        })
      expect(res.status).toBe(200)
      expect(res.body.sku).toBe(`SKU-CRUD-PUT-FULL-${ts}`)
      expect(res.body.categoryId).toBe(categoryB)
      expect(res.body.discount).toBe(125)

      const row = await prisma.product.findUnique({ where: { id } })
      expect(row!.name).toBe(`CRUD Put Full ${ts}`)
      expect(row!.sku).toBe(`SKU-CRUD-PUT-FULL-${ts}`)
      expect(row!.categoryId).toBe(categoryB)
      expect(Number(row!.price)).toBe(250)
      expect(Number(row!.mrp)).toBe(400)
      expect(Number(row!.discount)).toBe(125)
      expect(row!.stock).toBe(40)
      expect(Number(row!.netWeight)).toBe(1000)
      expect(row!.unit).toBe('1 kg')
      expect([...(row!.tags as string[])].sort()).toEqual(['full', 'update'])
      expect(row!.shelfLife).toBe('9 Months')
      expect(row!.storage).toBe('Cool and dry')

      const publicRead = await request(app).get(`/api/v1/products/${id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.name).toBe(`CRUD Put Full ${ts}`)
      expect(publicRead.body.categoryId).toBe(categoryB)
      expect(publicRead.body.discount).toBe(125)
      expect(publicRead.body.stock).toBe(40)
      expect(publicRead.body.ingredients).toEqual(['Ragi'])
    })
  })

  // =========================================================================
  // DELETE (soft)
  // =========================================================================
  describe('Delete', () => {
    it('soft-deletes: hidden publicly, still readable by admin, dropped from listings', async () => {
      const created = await createProduct({
        name: `CRUD Delete ${ts}`,
        sku: `SKU-CRUD-DEL-${ts}`,
        categoryId: categoryA,
        price: 60,
        mrp: 80,
        stock: 7,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const del = await request(app).delete(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(del.status).toBe(200)
      expect(del.body.success).toBe(true)

      const row = await prisma.product.findUnique({ where: { id } })
      expect(row!.isDeleted).toBe(true)
      expect(row!.deletedAt).not.toBeNull()
      expect(row!.status).toBe('ARCHIVED')
      expect(row!.isActive).toBe(false)

      // Gone from the storefront (detail + listing).
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)
      const items = await listingForCategory(categoryA)
      expect(items.some((p) => p.id === id)).toBe(false)

      // Still inspectable by an admin, flagged as deleted.
      const adminRead = await request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(adminRead.status).toBe(200)
      expect(adminRead.body.isDeleted).toBe(true)

      // ...but excluded from the admin listing.
      const adminList = await request(app).get('/api/v1/admin/products?limit=100').set(auth(adminToken))
      expect(adminList.status).toBe(200)
      expect(adminList.body.items.some((p: any) => p.id === id)).toBe(false)
    })
  })

  // =========================================================================
  // STATUS / ACTIVATION SEMANTICS
  // =========================================================================
  describe('Archive / activate / deactivate', () => {
    it('separates isActive visibility from lifecycle status', async () => {
      const created = await createProduct({
        name: `CRUD Status ${ts}`,
        sku: `SKU-CRUD-STATUS-${ts}`,
        categoryId: categoryA,
        price: 90,
        mrp: 100,
        stock: 4,
      })
      expect(created.status).toBe(201)
      const id = created.body.id
      expect(created.body.status).toBe('PUBLISHED')
      expect(created.body.active).toBe(true)

      // Deactivate: isActive false, status unchanged -> hidden.
      const off = await patchProduct(id, { isActive: false })
      expect(off.status).toBe(200)
      expect(off.body.active).toBe(false)
      let row = await prisma.product.findUnique({ where: { id } })
      expect(row!.isActive).toBe(false)
      expect(row!.status).toBe('PUBLISHED')
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)

      // Activate: public again.
      const on = await patchProduct(id, { isActive: true })
      expect(on.status).toBe(200)
      expect(on.body.active).toBe(true)
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(200)

      // Archive: status ARCHIVED -> hidden even though isActive stays true.
      const archived = await patchProduct(id, { status: 'ARCHIVED' })
      expect(archived.status).toBe(200)
      expect(archived.body.status).toBe('ARCHIVED')
      row = await prisma.product.findUnique({ where: { id } })
      expect(row!.status).toBe('ARCHIVED')
      expect(row!.isActive).toBe(true)
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)

      // Re-publish: back on the storefront.
      const published = await patchProduct(id, { status: 'PUBLISHED', isActive: true })
      expect(published.status).toBe(200)
      expect(published.body.status).toBe('PUBLISHED')
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(200)

      // Draft: hidden.
      const draft = await patchProduct(id, { status: 'DRAFT' })
      expect(draft.status).toBe(200)
      expect(draft.body.status).toBe('DRAFT')
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)

      // Leave it published so cleanup paths (if any) treat it as a normal row.
      await patchProduct(id, { status: 'PUBLISHED' })
    })
  })

  // =========================================================================
  // CATEGORY ASSIGNMENT & FILTERING
  // =========================================================================
  describe('Category assignment and filtering', () => {
    it('moves a product between categories and updates public category filtering', async () => {
      const created = await createProduct({
        name: `CRUD Category ${ts}`,
        sku: `SKU-CRUD-CAT-${ts}`,
        categoryId: categoryA,
        price: 50,
        mrp: 60,
        stock: 2,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      let inA = await listingForCategory(categoryA)
      let inB = await listingForCategory(categoryB)
      expect(inA.some((p) => p.id === id)).toBe(true)
      expect(inB.some((p) => p.id === id)).toBe(false)

      const moved = await patchProduct(id, { categoryId: categoryB })
      expect(moved.status).toBe(200)
      expect(moved.body.categoryId).toBe(categoryB)

      inA = await listingForCategory(categoryA)
      inB = await listingForCategory(categoryB)
      expect(inA.some((p) => p.id === id)).toBe(false)
      expect(inB.some((p) => p.id === id)).toBe(true)

      const row = await prisma.product.findUnique({ where: { id } })
      expect(row!.categoryId).toBe(categoryB)

      const publicRead = await request(app).get(`/api/v1/products/${id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.categoryId).toBe(categoryB)
      expect(publicRead.body.categoryName).toBe(`CRUD Cat B ${ts}`)
    })

    it('filters the public storefront by category slug as well as id', async () => {
      const created = await createProduct({
        name: `CRUD Slug Filter ${ts}`,
        sku: `SKU-CRUD-SLUGFILTER-${ts}`,
        categoryId: categoryA,
        price: 70,
        mrp: 90,
        stock: 1,
      })
      expect(created.status).toBe(201)

      const cat = await prisma.category.findUnique({ where: { id: categoryA } })
      expect(cat).not.toBeNull()

      const res = await request(app).get(`/api/v1/products?category=${cat!.slug}&per_page=100`)
      expect(res.status).toBe(200)
      expect(res.body.items.some((p: any) => p.id === created.body.id)).toBe(true)
    })
  })
})
