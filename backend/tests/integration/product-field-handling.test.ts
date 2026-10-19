import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'

/**
 * Product field handling, round-tripping and "no row on failure" guarantees.
 *
 * The sibling suites cover the HTTP status of invalid payloads; this one pins
 * the persistence contract behind them:
 *
 *   - every user-facing attribute survives create -> read (admin + public)
 *     -> update -> read;
 *   - the discount is derived from mrp/price at create and recomputed on
 *     update unless explicitly supplied, and an explicit value is preserved;
 *   - a rejected create/update writes NOTHING to the products table (a
 *     validator that 400s only after inserting would otherwise leak a
 *     half-built row).
 */
const app = createApp()
const ts = Date.now()

describe('Product field handling, round-trip and no-write-on-failure', () => {
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

  beforeAll(async () => {
    const admin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = admin.accessToken

    const cat = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(adminToken))
      .send({ name: `Field Handling ${ts}`, accent: '#112233' })
    expect(cat.status).toBe(201)
    categoryId = cat.body.id
    createdCategoryIds.push(categoryId)
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

  // =========================================================================
  // 1. FULL ATTRIBUTE ROUND-TRIP
  // =========================================================================
  describe('Attribute round-trip', () => {
    it('persists every supplied field on create and returns it admin + public', async () => {
      const sku = `SKU-FIELDS-${ts}`
      const res = await createProduct({
        name: `Field Rich Product ${ts}`,
        sku,
        categoryId,
        shortDescription: 'A short punchy summary',
        description: 'A much longer marketing description with detail.',
        price: 249.5,
        mrp: 399,
        unit: '750 g',
        netWeight: 750,
        shelfLife: '9 Months',
        storage: 'Store cool and dry',
        tags: ['quinoa', 'protein'],
        ingredients: ['Quinoa', 'Barnyard Millet'],
        allergens: ['None'],
        nutrition: [
          { label: 'Energy', value: '400 kcal' },
          { label: 'Protein', value: '12 g' },
        ],
        isOrganic: true,
        isBestSeller: true,
        isNew: true,
        images: [
          { imageUrl: 'https://media.example.com/front.png', altText: 'Front', isPrimary: true, displayOrder: 0 },
          { imageUrl: 'https://media.example.com/back.png', altText: 'Back', displayOrder: 1 },
        ],
      })
      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.discount).toBe(149.5)

      // Admin read sees the full record.
      const adminRead = await request(app).get(`/api/v1/admin/products/${res.body.id}`).set(auth(adminToken))
      expect(adminRead.status).toBe(200)
      expect(adminRead.body.name).toBe(`Field Rich Product ${ts}`)
      expect(adminRead.body.sku).toBe(sku)
      expect(adminRead.body.shortDescription).toBe('A short punchy summary')
      expect(adminRead.body.description).toBe('A much longer marketing description with detail.')
      expect(adminRead.body.price).toBe(249.5)
      expect(adminRead.body.mrp).toBe(399)
      expect(adminRead.body.discount).toBe(149.5)
      expect(adminRead.body.unit).toBe('750 g')
      expect(adminRead.body.shelfLife).toBe('9 Months')
      expect(adminRead.body.storage).toBe('Store cool and dry')
      expect(adminRead.body.tags).toEqual(['quinoa', 'protein'])
      expect(adminRead.body.ingredients).toEqual(['Quinoa', 'Barnyard Millet'])
      expect(adminRead.body.allergens).toEqual(['None'])
      expect(adminRead.body.nutrition).toHaveLength(2)
      expect(adminRead.body.nutrition[0]).toEqual({ label: 'Energy', value: '400 kcal' })
      expect(adminRead.body.categoryId).toBe(categoryId)
      expect(adminRead.body.isOrganic).toBe(true)
      expect(adminRead.body.isBestSeller).toBe(true)
      expect(adminRead.body.isNew).toBe(true)

      // Public read exposes storefront fields (and strips internals).
      const publicRead = await request(app).get(`/api/v1/products/${res.body.id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.sku).toBe(sku)
      expect(publicRead.body.shortDescription).toBe('A short punchy summary')
      expect(publicRead.body.description).toBe('A much longer marketing description with detail.')
      expect(publicRead.body.ingredients).toEqual(['Quinoa', 'Barnyard Millet'])
      expect(publicRead.body.nutrition).toHaveLength(2)
      expect(publicRead.body.images).toEqual([
        'https://media.example.com/front.png',
        'https://media.example.com/back.png',
      ])
      expect(publicRead.body.primaryImage).toBe('https://media.example.com/front.png')
      expect(publicRead.body.gallery).toHaveLength(2)
      expect(publicRead.body.gallery[0].isPrimary).toBe(true)
      expect(publicRead.body).not.toHaveProperty('s3Key')
      expect(publicRead.body).not.toHaveProperty('inventory')

      // netWeight is not projected into the API payload but must persist.
      const dbRow = await prisma.product.findUnique({ where: { id: res.body.id } })
      expect(Number(dbRow?.netWeight)).toBe(750)
    })

    it('round-trips field updates and replaces the gallery via the images array', async () => {
      const created = await createProduct({
        name: `Update Roundtrip ${ts}`,
        sku: `SKU-ROUNDTRIP-${ts}`,
        categoryId,
        price: 100,
        mrp: 150,
        stock: 12,
        description: 'Before',
        ingredients: ['Old Ingredient'],
        nutrition: [{ label: 'Energy', value: '100 kcal' }],
        tags: ['old'],
        images: ['https://media.example.com/old.png'],
      })
      expect(created.status).toBe(201)

      const updated = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({
          shortDescription: 'Updated short',
          description: 'After',
          ingredients: ['New Ingredient', 'Second Ingredient'],
          allergens: ['Soy'],
          nutrition: [{ label: 'Energy', value: '220 kcal' }, { label: 'Fat', value: '5 g' }],
          tags: ['fresh', 'new'],
          unit: '1 kg',
          netWeight: 1000,
          images: ['https://media.example.com/new-1.png', 'https://media.example.com/new-2.png'],
        })
      expect(updated.status).toBe(200)

      const publicRead = await request(app).get(`/api/v1/products/${created.body.id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.shortDescription).toBe('Updated short')
      expect(publicRead.body.description).toBe('After')
      expect(publicRead.body.ingredients).toEqual(['New Ingredient', 'Second Ingredient'])
      expect(publicRead.body.allergens).toEqual(['Soy'])
      expect(publicRead.body.nutrition).toHaveLength(2)
      expect(publicRead.body.tags).toEqual(['fresh', 'new'])
      expect(publicRead.body.unit).toBe('1 kg')
      // Old image replaced, first new image promoted to primary.
      expect(publicRead.body.images).toEqual([
        'https://media.example.com/new-1.png',
        'https://media.example.com/new-2.png',
      ])
      expect(publicRead.body.primaryImage).toBe('https://media.example.com/new-1.png')

      const dbRow = await prisma.product.findUnique({ where: { id: created.body.id } })
      expect(Number(dbRow?.netWeight)).toBe(1000)
      // Exactly one gallery row is primary.
      const primaries = await prisma.productImage.count({
        where: { productId: created.body.id, isPrimary: true },
      })
      expect(primaries).toBe(1)
    })
  })

  // =========================================================================
  // 2. DISCOUNT DERIVATION
  // =========================================================================
  describe('Discount derivation (mrp vs price vs explicit discount)', () => {
    it('derives discount as mrp - price when none is supplied', async () => {
      const res = await createProduct({
        name: `Derived Discount ${ts}`,
        sku: `SKU-DERIVED-${ts}`,
        categoryId,
        price: 80,
        mrp: 100,
      })
      expect(res.status).toBe(201)
      expect(res.body.discount).toBe(20)
    })

    it('preserves an explicit discount even when it differs from mrp - price', async () => {
      const res = await createProduct({
        name: `Explicit Discount Roundtrip ${ts}`,
        sku: `SKU-EXPLICIT-${ts}`,
        categoryId,
        price: 80,
        mrp: 100,
        discount: 45,
      })
      expect(res.status).toBe(201)
      expect(res.body.discount).toBe(45)
    })

    it('recomputes the discount when the price changes', async () => {
      const created = await createProduct({
        name: `Recompute Price ${ts}`,
        sku: `SKU-RECOMPUTE-P-${ts}`,
        categoryId,
        price: 200,
        mrp: 300,
      })
      expect(created.body.discount).toBe(100)

      const updated = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({ price: 250 })
      expect(updated.status).toBe(200)
      expect(updated.body.discount).toBe(50)
    })

    it('recomputes the discount when the mrp changes', async () => {
      const created = await createProduct({
        name: `Recompute Mrp ${ts}`,
        sku: `SKU-RECOMPUTE-M-${ts}`,
        categoryId,
        price: 200,
        mrp: 300,
      })
      expect(created.body.discount).toBe(100)

      const updated = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({ mrp: 350 })
      expect(updated.status).toBe(200)
      expect(updated.body.discount).toBe(150)
    })

    it('keeps an explicit discount stable across an unrelated update', async () => {
      const created = await createProduct({
        name: `Stable Discount ${ts}`,
        sku: `SKU-STABLE-DISC-${ts}`,
        categoryId,
        price: 200,
        mrp: 300,
        discount: 130,
      })
      expect(created.body.discount).toBe(130)

      const updated = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({ name: `Stable Discount Renamed ${ts}` })
      expect(updated.status).toBe(200)
      expect(updated.body.discount).toBe(130)
    })
  })

  // =========================================================================
  // 3. NO-ROW-WRITTEN-ON-FAILURE
  // =========================================================================
  describe('Rejected writes leave the products table untouched', () => {
    const absent = async (sku: string) => {
      const count = await prisma.product.count({ where: { sku } })
      expect(count).toBe(0)
    }

    it('writes no row for a negative price', async () => {
      const sku = `SKU-NOWRITE-NEGP-${ts}`
      const res = await createProduct({ name: `No Write Neg Price ${ts}`, sku, price: -5, mrp: 20, categoryId })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no row for a zero price', async () => {
      const sku = `SKU-NOWRITE-ZEROP-${ts}`
      const res = await createProduct({ name: `No Write Zero Price ${ts}`, sku, price: 0, mrp: 20, categoryId })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no row for a negative stock', async () => {
      const sku = `SKU-NOWRITE-NEGSTK-${ts}`
      const res = await createProduct({ name: `No Write Neg Stock ${ts}`, sku, price: 10, mrp: 20, stock: -1, categoryId })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no row when a required field is missing', async () => {
      const sku = `SKU-NOWRITE-MISSING-${ts}`
      const res = await createProduct({ sku, price: 10, mrp: 20, categoryId })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no row for an over-long metaTitle', async () => {
      const sku = `SKU-NOWRITE-METATITLE-${ts}`
      const res = await createProduct({
        name: `No Write Meta Title ${ts}`,
        sku,
        price: 10,
        mrp: 20,
        categoryId,
        metaTitle: 'T'.repeat(201),
      })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no row for an over-long metaDescription', async () => {
      const sku = `SKU-NOWRITE-METADESC-${ts}`
      const res = await createProduct({
        name: `No Write Meta Desc ${ts}`,
        sku,
        price: 10,
        mrp: 20,
        categoryId,
        metaDescription: 'D'.repeat(501),
      })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no row for a well-formed but unknown category id', async () => {
      const sku = `SKU-NOWRITE-BADCAT-${ts}`
      const res = await createProduct({
        name: `No Write Bad Category ${ts}`,
        sku,
        price: 10,
        mrp: 20,
        categoryId: '00000000-0000-0000-0000-000000000000',
      })
      expect(res.status).toBe(400)
      await absent(sku)
    })

    it('writes no additional row when the SKU is duplicated', async () => {
      const sku = `SKU-NOWRITE-DUP-${ts}`
      const first = await createProduct({ name: `Dup Base ${ts}`, sku, price: 10, mrp: 20, categoryId })
      expect(first.status).toBe(201)

      const second = await createProduct({ name: `Dup Attempt ${ts}`, sku, price: 30, mrp: 40, categoryId })
      expect(second.status).toBe(409)

      const rows = await prisma.product.count({ where: { sku } })
      expect(rows).toBe(1)
      const leaked = await prisma.product.count({ where: { name: `Dup Attempt ${ts}` } })
      expect(leaked).toBe(0)
    })

    it('leaves the row unchanged when an update is rejected', async () => {
      const created = await createProduct({
        name: `Unchanged On Reject ${ts}`,
        sku: `SKU-NOWRITE-UPD-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
      })
      expect(created.status).toBe(201)

      const rejected = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({ price: 9999 })
      expect(rejected.status).toBe(400)

      const dbRow = await prisma.product.findUnique({ where: { id: created.body.id } })
      expect(Number(dbRow?.price)).toBe(100)
      expect(Number(dbRow?.mrp)).toBe(120)
    })
  })

  // =========================================================================
  // 4. LONG DESCRIPTION IS ACCEPTED (unbounded), SKU/NAME BOUNDED
  // =========================================================================
  describe('String length boundaries', () => {
    it('accepts a very long untyped description', async () => {
      const res = await createProduct({
        name: `Long Description ${ts}`,
        sku: `SKU-LONGDESC-OK-${ts}`,
        categoryId,
        price: 10,
        mrp: 20,
        description: 'x'.repeat(5000),
      })
      expect(res.status).toBe(201)
      const publicRead = await request(app).get(`/api/v1/products/${res.body.id}`)
      expect(publicRead.body.description).toHaveLength(5000)
    })

    it('accepts a name / SKU exactly at the length limit', async () => {
      const name = 'N'.repeat(200)
      const sku = 'S'.repeat(100)
      const res = await createProduct({ name, sku, categoryId, price: 10, mrp: 20 })
      expect(res.status).toBe(201)
      expect(res.body.name).toHaveLength(200)
      expect(res.body.sku).toHaveLength(100)
    })
  })
})
