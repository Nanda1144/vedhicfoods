import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'

/**
 * Product field round-tripping and input validation.
 *
 * Two contracts are pinned here:
 *
 *   1. every user-facing attribute survives create -> admin read -> public read
 *      -> update -> admin/public read, and the persisted row matches;
 *   2. invalid input is rejected with the right status and a machine-readable
 *      error body — a 400 with per-field validation `details` for schema
 *      violations, and a mapped 409 (never a 500) for a duplicate SKU.
 *
 * Image file-size / MIME validation is deliberately out of scope (owned by
 * another suite); only the `images` array as a *product field* is exercised.
 */
const app = createApp()
const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Product field round-trip and validation', () => {
  let adminToken: string
  let categoryId: string
  let secondCategoryId: string

  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function createCategory(name: string) {
    const res = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(adminToken))
      .send({ name, accent: '#654321' })
    if (res.status === 201 && res.body?.id) createdCategoryIds.push(res.body.id)
    return res
  }

  async function createProduct(body: Record<string, any>) {
    const res = await request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(body)
    if (res.status === 201 && res.body?.id) createdProductIds.push(res.body.id)
    return res
  }

  async function patchProduct(id: string, body: Record<string, any>) {
    return request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send(body)
  }

  /** Asserts a 400 whose body carries per-field Zod validation details. */
  function expectValidationError(res: any, field?: string) {
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(res.body.details)).toBe(true)
    expect(res.body.details.length).toBeGreaterThan(0)
    if (field) {
      expect(res.body.details.some((d: any) => d.field === field)).toBe(true)
    }
  }

  beforeAll(async () => {
    const admin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = admin.accessToken

    const a = await createCategory(`Fields Cat A ${ts}`)
    expect(a.status).toBe(201)
    categoryId = a.body.id

    const b = await createCategory(`Fields Cat B ${ts}`)
    expect(b.status).toBe(201)
    secondCategoryId = b.body.id
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
  // 1. FIELD ROUND-TRIP (create + update)
  // =========================================================================
  describe('Field round-trip', () => {
    it('persists and returns every field on create, then updates each one', async () => {
      const sku = `SKU-FRT-${ts}`
      const created = await createProduct({
        name: `Field RT ${ts}`,
        sku,
        categoryId,
        shortDescription: 'Short RT',
        description: 'Long RT description',
        price: 199,
        mrp: 299,
        stock: 15,
        unit: '500 g',
        netWeight: 500,
        tags: ['rt', 'field'],
        ingredients: ['Foxtail Millet', 'Sea Salt'],
        allergens: ['None'],
        nutrition: [
          { label: 'Energy', value: '350 kcal' },
          { label: 'Protein', value: '9 g' },
        ],
        images: ['https://media.example.com/frt-1.png', 'https://media.example.com/frt-2.png'],
        isOrganic: true,
        isBestSeller: true,
        isNew: true,
      })
      expect(created.status).toBe(201)
      expect(created.body.discount).toBe(100)
      const id = created.body.id

      // Admin read.
      const adminRead = await request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(adminRead.status).toBe(200)
      expect(adminRead.body.name).toBe(`Field RT ${ts}`)
      expect(adminRead.body.sku).toBe(sku)
      expect(adminRead.body.shortDescription).toBe('Short RT')
      expect(adminRead.body.description).toBe('Long RT description')
      expect(adminRead.body.price).toBe(199)
      expect(adminRead.body.mrp).toBe(299)
      expect(adminRead.body.discount).toBe(100)
      expect(adminRead.body.stock).toBe(15)
      expect(adminRead.body.categoryId).toBe(categoryId)
      expect(adminRead.body.unit).toBe('500 g')
      expect(adminRead.body.ingredients).toEqual(['Foxtail Millet', 'Sea Salt'])
      expect(adminRead.body.allergens).toEqual(['None'])
      expect(adminRead.body.nutrition).toEqual([
        { label: 'Energy', value: '350 kcal' },
        { label: 'Protein', value: '9 g' },
      ])
      expect([...adminRead.body.tags].sort()).toEqual(['field', 'rt'])
      expect(adminRead.body.isOrganic).toBe(true)
      expect(adminRead.body.isBestSeller).toBe(true)
      expect(adminRead.body.isNew).toBe(true)

      // Public read.
      const publicCreate = await request(app).get(`/api/v1/products/${id}`)
      expect(publicCreate.status).toBe(200)
      expect(publicCreate.body.description).toBe('Long RT description')
      expect(publicCreate.body.ingredients).toEqual(['Foxtail Millet', 'Sea Salt'])
      expect(publicCreate.body.nutrition).toHaveLength(2)
      expect(publicCreate.body.images).toEqual([
        'https://media.example.com/frt-1.png',
        'https://media.example.com/frt-2.png',
      ])
      expect(publicCreate.body.primaryImage).toBe('https://media.example.com/frt-1.png')

      // Persisted row (netWeight is not projected into the API payload).
      const createRow = await prisma.product.findUnique({ where: { id } })
      expect(Number(createRow!.netWeight)).toBe(500)
      expect(createRow!.ingredients).toEqual(['Foxtail Millet', 'Sea Salt'])
      expect(createRow!.nutrition).toEqual([
        { label: 'Energy', value: '350 kcal' },
        { label: 'Protein', value: '9 g' },
      ])

      // Update every field.
      const updated = await patchProduct(id, {
        name: `Field RT Updated ${ts}`,
        sku: `SKU-FRT-UPD-${ts}`,
        categoryId: secondCategoryId,
        shortDescription: 'Updated short',
        description: 'Updated description',
        price: 249,
        mrp: 349,
        discount: 80,
        stock: 22,
        unit: '1 kg',
        netWeight: 1000,
        tags: ['updated'],
        ingredients: ['Ragi', 'Jaggery'],
        allergens: ['None'],
        nutrition: [{ label: 'Energy', value: '400 kcal' }],
        images: ['https://media.example.com/frt-new.png'],
      })
      expect(updated.status).toBe(200)

      const updateRow = await prisma.product.findUnique({ where: { id } })
      expect(updateRow!.name).toBe(`Field RT Updated ${ts}`)
      expect(updateRow!.sku).toBe(`SKU-FRT-UPD-${ts}`)
      expect(updateRow!.categoryId).toBe(secondCategoryId)
      expect(Number(updateRow!.price)).toBe(249)
      expect(Number(updateRow!.mrp)).toBe(349)
      expect(Number(updateRow!.discount)).toBe(80)
      expect(updateRow!.stock).toBe(22)
      expect(Number(updateRow!.netWeight)).toBe(1000)
      expect(updateRow!.unit).toBe('1 kg')
      expect(updateRow!.ingredients).toEqual(['Ragi', 'Jaggery'])
      expect(updateRow!.nutrition).toEqual([{ label: 'Energy', value: '400 kcal' }])

      const publicUpdate = await request(app).get(`/api/v1/products/${id}`)
      expect(publicUpdate.status).toBe(200)
      expect(publicUpdate.body.description).toBe('Updated description')
      expect(publicUpdate.body.price).toBe(249)
      expect(publicUpdate.body.discount).toBe(80)
      expect(publicUpdate.body.stock).toBe(22)
      expect(publicUpdate.body.ingredients).toEqual(['Ragi', 'Jaggery'])
      expect(publicUpdate.body.nutrition).toEqual([{ label: 'Energy', value: '400 kcal' }])
      expect(publicUpdate.body.images).toEqual(['https://media.example.com/frt-new.png'])
      expect(publicUpdate.body.primaryImage).toBe('https://media.example.com/frt-new.png')
    })

    it('derives, preserves and recomputes the discount correctly', async () => {
      const derived = await createProduct({
        name: `Discount Derived ${ts}`,
        sku: `SKU-DISC-DERIVED-${ts}`,
        categoryId,
        price: 80,
        mrp: 100,
      })
      expect(derived.status).toBe(201)
      expect(derived.body.discount).toBe(20)

      const explicit = await createProduct({
        name: `Discount Explicit ${ts}`,
        sku: `SKU-DISC-EXPLICIT-${ts}`,
        categoryId,
        price: 80,
        mrp: 100,
        discount: 45,
      })
      expect(explicit.status).toBe(201)
      expect(explicit.body.discount).toBe(45)

      // Changing the price recomputes a derived discount...
      const recomputed = await patchProduct(derived.body.id, { price: 60 })
      expect(recomputed.status).toBe(200)
      expect(recomputed.body.discount).toBe(40)

      // ...but an explicit discount is stable across an unrelated edit.
      const stable = await patchProduct(explicit.body.id, { name: `Discount Explicit Renamed ${ts}` })
      expect(stable.status).toBe(200)
      expect(stable.body.discount).toBe(45)
    })

    it('tracks stock state from the linked inventory row', async () => {
      const created = await createProduct({
        name: `Stock State ${ts}`,
        sku: `SKU-STOCK-STATE-${ts}`,
        categoryId,
        price: 120,
        mrp: 150,
        stock: 0,
      })
      expect(created.status).toBe(201)
      expect(created.body.stock).toBe(0)
      expect(created.body.availability).toBe('OUT_OF_STOCK')
      expect(created.body.isAvailable).toBe(false)
      const inv = await prisma.inventory.findUnique({ where: { productId: created.body.id } })
      expect(inv?.status).toBe('OUT_OF_STOCK')
      expect(inv?.availableQuantity).toBe(0)

      const restocked = await patchProduct(created.body.id, { stock: 25 })
      expect(restocked.status).toBe(200)
      expect(restocked.body.stock).toBe(25)
      expect(restocked.body.availability).toBe('IN_STOCK')
      expect(restocked.body.isAvailable).toBe(true)
      const inv2 = await prisma.inventory.findUnique({ where: { productId: created.body.id } })
      expect(inv2?.status).toBe('IN_STOCK')
      expect(inv2?.availableQuantity).toBe(25)
    })
  })

  // =========================================================================
  // 2. PRICE / MRP VALIDATION
  // =========================================================================
  describe('Price and MRP validation', () => {
    const withPrice = (price: any, mrp: any = 100) => ({
      name: `Bad Price ${ts}`,
      sku: `SKU-BADPRICE-${ts}-${Math.random().toString(36).slice(2, 7)}`,
      categoryId,
      price,
      mrp,
    })

    it('rejects a negative price', async () => {
      const res = await createProduct(withPrice(-5))
      expectValidationError(res, 'price')
    })

    it('rejects a zero price', async () => {
      const res = await createProduct(withPrice(0))
      expectValidationError(res, 'price')
    })

    it('rejects a non-numeric price', async () => {
      for (const bad of ['abc', {}, [], null, true]) {
        const res = await createProduct(withPrice(bad))
        expectValidationError(res, 'price')
      }
    })

    it('rejects a negative, zero or non-numeric MRP', async () => {
      for (const [price, mrp] of [[5, -20], [5, 0], [5, 'nope'], [5, true]] as const) {
        const res = await createProduct(withPrice(price, mrp))
        expectValidationError(res, 'mrp')
      }
    })

    it('rejects a create whose price exceeds the MRP', async () => {
      const res = await createProduct(withPrice(200, 100))
      expectValidationError(res, 'price')
    })

    it('rejects an update that pushes the price above the existing MRP', async () => {
      const created = await createProduct({
        name: `Price Ceiling ${ts}`,
        sku: `SKU-PRICE-CEIL-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
      })
      expect(created.status).toBe(201)

      const res = await patchProduct(created.body.id, { price: 9999 })
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)

      // The row is unchanged.
      const row = await prisma.product.findUnique({ where: { id: created.body.id } })
      expect(Number(row!.price)).toBe(100)
      expect(Number(row!.mrp)).toBe(120)
    })
  })

  // =========================================================================
  // 3. STOCK VALIDATION
  // =========================================================================
  describe('Stock validation', () => {
    it('rejects a negative stock quantity', async () => {
      const res = await createProduct({
        name: `Neg Stock ${ts}`,
        sku: `SKU-NEG-STOCK-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
        stock: -1,
      })
      expectValidationError(res, 'stock')
    })

    it('rejects a fractional stock quantity', async () => {
      const res = await createProduct({
        name: `Frac Stock ${ts}`,
        sku: `SKU-FRAC-STOCK-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
        stock: 1.5,
      })
      expectValidationError(res, 'stock')
    })

    it('rejects a negative stock on update', async () => {
      const created = await createProduct({
        name: `Neg Stock Upd ${ts}`,
        sku: `SKU-NEG-STOCK-UPD-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
        stock: 5,
      })
      expect(created.status).toBe(201)
      const res = await patchProduct(created.body.id, { stock: -3 })
      expectValidationError(res, 'stock')
      const row = await prisma.product.findUnique({ where: { id: created.body.id } })
      expect(row!.stock).toBe(5)
    })
  })

  // =========================================================================
  // 4. DUPLICATE SKU
  // =========================================================================
  describe('Duplicate SKU handling', () => {
    it('maps a duplicate SKU on create to 409, not 500', async () => {
      const sku = `SKU-DUP-CREATE-${ts}`
      const first = await createProduct({ name: `Dup Base ${ts}`, sku, categoryId, price: 10, mrp: 20 })
      expect(first.status).toBe(201)

      const second = await createProduct({ name: `Dup Attempt ${ts}`, sku, categoryId, price: 30, mrp: 40 })
      expect(second.status).toBe(409)
      expect(second.body.code).toBe('CONFLICT')

      const count = await prisma.product.count({ where: { sku } })
      expect(count).toBe(1)
    })

    it('maps an update to an already-used SKU to 409', async () => {
      const skuA = `SKU-DUP-UPD-A-${ts}`
      const skuB = `SKU-DUP-UPD-B-${ts}`
      const a = await createProduct({ name: `Dup Update A ${ts}`, sku: skuA, categoryId, price: 10, mrp: 20 })
      const b = await createProduct({ name: `Dup Update B ${ts}`, sku: skuB, categoryId, price: 10, mrp: 20 })
      expect(a.status).toBe(201)
      expect(b.status).toBe(201)

      const res = await patchProduct(b.body.id, { sku: skuA })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('CONFLICT')

      const row = await prisma.product.findUnique({ where: { id: b.body.id } })
      expect(row!.sku).toBe(skuB)
    })

    it('serialises concurrent creates of the same SKU to one 201 and one 409', async () => {
      const sku = `SKU-DUP-RACE-${ts}`
      const payload = (name: string) => ({ name, sku, categoryId, price: 10, mrp: 20 })

      const [r1, r2] = await Promise.all([
        request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(payload(`Race One ${ts}`)),
        request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(payload(`Race Two ${ts}`)),
      ])

      const statuses = [r1.status, r2.status].sort()
      expect(statuses).toEqual([201, 409])
      // A genuine race must never surface as a 500.
      expect([r1.status, r2.status]).not.toContain(500)

      const winner = r1.status === 201 ? r1 : r2
      if (winner.body?.id) createdProductIds.push(winner.body.id)

      const count = await prisma.product.count({ where: { sku } })
      expect(count).toBe(1)
    })
  })

  // =========================================================================
  // 5. MISSING REQUIRED FIELDS
  // =========================================================================
  describe('Missing required fields', () => {
    it('returns 400 with per-field details for each required field', async () => {
      const base = {
        name: `Required ${ts}`,
        sku: `SKU-REQUIRED-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
      }

      const missingName = await createProduct({ ...base, name: undefined })
      expectValidationError(missingName, 'name')

      const missingSku = await createProduct({ ...base, sku: undefined })
      expectValidationError(missingSku, 'sku')

      const missingPrice = await createProduct({ ...base, price: undefined })
      expectValidationError(missingPrice, 'price')

      const missingMrp = await createProduct({ ...base, mrp: undefined })
      expectValidationError(missingMrp, 'mrp')
    })
  })

  // =========================================================================
  // 6. CATEGORY REFERENCES
  // =========================================================================
  describe('Category references', () => {
    it('rejects a malformed category UUID on create', async () => {
      const res = await createProduct({
        name: `Bad Cat ${ts}`,
        sku: `SKU-BADCAT-${ts}`,
        categoryId: 'not-a-uuid',
        price: 10,
        mrp: 20,
      })
      expectValidationError(res, 'categoryId')
    })

    it('rejects a well-formed but non-existent category UUID on create', async () => {
      const res = await createProduct({
        name: `Ghost Cat ${ts}`,
        sku: `SKU-GHOSTCAT-${ts}`,
        categoryId: '00000000-0000-0000-0000-000000000000',
        price: 10,
        mrp: 20,
      })
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(String(res.body.error)).toContain('Category')
    })

    it('rejects a non-existent category slug on create', async () => {
      const res = await createProduct({
        name: `Ghost Slug ${ts}`,
        sku: `SKU-GHOSTSLUG-${ts}`,
        categorySlug: `no-such-category-${ts}`,
        price: 10,
        mrp: 20,
      })
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)
      expect(String(res.body.error)).toContain('Category')
    })

    it('rejects an update pointing at a non-existent category', async () => {
      const created = await createProduct({
        name: `Cat Upd ${ts}`,
        sku: `SKU-CAT-UPD-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
      })
      expect(created.status).toBe(201)

      const res = await patchProduct(created.body.id, {
        categoryId: '00000000-0000-0000-0000-000000000000',
      })
      expect(res.status).toBe(400)
      expect(res.body.success).toBe(false)

      const row = await prisma.product.findUnique({ where: { id: created.body.id } })
      expect(row!.categoryId).toBe(categoryId)
    })
  })

  // =========================================================================
  // 7. MISC VALIDATION
  // =========================================================================
  describe('Other validation guards', () => {
    it('rejects an unknown lifecycle status', async () => {
      const res = await createProduct({
        name: `Bad Status ${ts}`,
        sku: `SKU-BAD-STATUS-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
        status: 'NOPE',
      })
      expectValidationError(res, 'status')
    })

    it('rejects a negative discount on update', async () => {
      const created = await createProduct({
        name: `Bad Discount ${ts}`,
        sku: `SKU-BAD-DISC-${ts}`,
        categoryId,
        price: 50,
        mrp: 80,
      })
      expect(created.status).toBe(201)
      const res = await patchProduct(created.body.id, { discount: -1 })
      expectValidationError(res, 'discount')
    })

    it('rejects a malformed image URL in the images array', async () => {
      const res = await createProduct({
        name: `Bad Image Url ${ts}`,
        sku: `SKU-BAD-IMGURL-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
        images: ['not-a-url'],
      })
      expectValidationError(res)
      expect(res.body.details.some((d: any) => d.field.startsWith('images'))).toBe(true)
    })
  })
})
