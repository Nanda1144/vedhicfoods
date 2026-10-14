import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'
import { S3Service } from '../../src/integrations/aws/s3/s3.service'

const app = createApp()

const ts = Date.now()

describe('Catalog Extended Coverage (Product, Category, Images, Security)', () => {
  let adminToken: string
  let customerToken: string
  let staffToken: string

  let categoryId: string
  let productId: string
  let productSku: string

  // Every fixture this suite creates is tracked so the afterAll hook can remove
  // it. Without this, the dozens of products (several with zero stock) created
  // by the negative/positive catalog cases leak into the shared test database
  // across runs — eventually pushing domain fixtures off the first page of the
  // paginated low-stock listing and breaking unrelated suites.
  const createdCategoryIds: string[] = []
  const createdProductIds: string[] = []

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function createCategory(name: string, extra: Record<string, any> = {}) {
    const res = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(adminToken))
      .send({ name, ...extra })
    if (res.status === 201 && res.body?.id) createdCategoryIds.push(res.body.id)
    return res
  }

  async function createProduct(body: Record<string, any>) {
    const res = await request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(body)
    if (res.status === 201 && res.body?.id) createdProductIds.push(res.body.id)
    return res
  }

  async function presign(pid: string, body: Record<string, any>) {
    return request(app)
      .post(`/api/v1/admin/products/${pid}/images/presigned-url`)
      .set(auth(adminToken))
      .send(body)
  }

  beforeAll(async () => {
    const admin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = admin.accessToken
    const customer = await AuthService.login({ email: 'customer@vedhicfoods.com', password: 'Customer@Vedhic2026' })
    customerToken = customer.accessToken
    const staff = await AuthService.login({ email: 'staff@vedhicfoods.com', password: 'Staff@Vedhic2026' })
    staffToken = staff.accessToken

    const cat = await createCategory(`Extended Catalog ${ts}`, { accent: '#123456', sortOrder: 5 })
    expect(cat.status).toBe(201)
    categoryId = cat.body.id

    productSku = `SKU-EXT-${ts}`
    const prod = await createProduct({
      name: `Extended Product ${ts}`,
      sku: productSku,
      categoryId,
      price: 240,
      mrp: 300,
      stock: 30,
      description: 'Base extended product',
      ingredients: ['Millet'],
      nutrition: [{ label: 'Protein', value: '7g' }],
      netWeight: 1000,
      unit: '1 kg',
    })
    expect(prod.status).toBe(201)
    productId = prod.body.id
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
  // 1. PRODUCT REQUIRED FIELDS & BOUNDARY VALIDATION
  // =========================================================================
  describe('Product required fields and boundary validation', () => {
    it('rejects a product with no name', async () => {
      const res = await createProduct({ sku: `SKU-NONAME-${ts}`, price: 10, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a product with no SKU', async () => {
      const res = await createProduct({ name: `No SKU ${ts}`, price: 10, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a product with no price', async () => {
      const res = await createProduct({ name: `No Price ${ts}`, sku: `SKU-NOPRICE-${ts}`, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a product with no MRP', async () => {
      const res = await createProduct({ name: `No MRP ${ts}`, sku: `SKU-NOMRP-${ts}`, price: 10, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a negative selling price', async () => {
      const res = await createProduct({ name: `Neg Price ${ts}`, sku: `SKU-NEG-${ts}`, price: -5, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a zero selling price', async () => {
      const res = await createProduct({ name: `Zero Price ${ts}`, sku: `SKU-ZERO-${ts}`, price: 0, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a negative MRP', async () => {
      const res = await createProduct({ name: `Neg MRP ${ts}`, sku: `SKU-NEGMRP-${ts}`, price: 5, mrp: -20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a zero MRP', async () => {
      const res = await createProduct({ name: `Zero MRP ${ts}`, sku: `SKU-ZEROMRP-${ts}`, price: 5, mrp: 0, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a negative stock quantity', async () => {
      const res = await createProduct({ name: `Neg Stock ${ts}`, sku: `SKU-NEGSTK-${ts}`, price: 10, mrp: 20, stock: -3, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a fractional stock quantity', async () => {
      const res = await createProduct({ name: `Frac Stock ${ts}`, sku: `SKU-FRACSTK-${ts}`, price: 10, mrp: 20, stock: 1.5, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects a negative net weight', async () => {
      const res = await createProduct({ name: `Neg Weight ${ts}`, sku: `SKU-NEGWT-${ts}`, price: 10, mrp: 20, netWeight: -100, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects an over-long product name (max 200)', async () => {
      const res = await createProduct({ name: 'A'.repeat(201), sku: `SKU-LONGNAME-${ts}`, price: 10, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects an over-long SKU (max 100)', async () => {
      const res = await createProduct({ name: `Long SKU ${ts}`, sku: 'S'.repeat(101), price: 10, mrp: 20, categoryId })
      expect(res.status).toBe(400)
    })

    it('rejects an over-long short description (max 500)', async () => {
      const res = await createProduct({ name: `Long Desc ${ts}`, sku: `SKU-LONGDESC-${ts}`, price: 10, mrp: 20, shortDescription: 'D'.repeat(501), categoryId })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // 2. PRODUCT CATEGORY REFERENCES & DUPLICATION
  // =========================================================================
  describe('Product category references and duplication', () => {
    it('rejects a malformed category UUID', async () => {
      const res = await createProduct({ name: `Bad Cat ${ts}`, sku: `SKU-BADCAT-${ts}`, price: 10, mrp: 20, categoryId: 'not-a-uuid' })
      expect(res.status).toBe(400)
    })

    it('rejects a well-formed but non-existent category UUID', async () => {
      const res = await createProduct({ name: `Ghost Cat ${ts}`, sku: `SKU-GHOSTCAT-${ts}`, price: 10, mrp: 20, categoryId: '00000000-0000-0000-0000-000000000000' })
      expect(res.status).toBe(400)
    })

    it('rejects a non-existent category slug', async () => {
      const res = await createProduct({ name: `Ghost Slug ${ts}`, sku: `SKU-GHOSTSLUG-${ts}`, price: 10, mrp: 20, categorySlug: `no-such-category-${ts}` })
      expect(res.status).toBe(400)
    })

    it('rejects a duplicate SKU with 409', async () => {
      const res = await createProduct({ name: `Dup SKU ${ts}`, sku: productSku, price: 10, mrp: 20, categoryId })
      expect(res.status).toBe(409)
    })

    it('allows duplicate product names but generates distinct slugs', async () => {
      const name = `Duplicate Name Allowed ${ts}`
      const a = await createProduct({ name, sku: `SKU-DUPNAME-A-${ts}`, price: 10, mrp: 20, categoryId })
      const b = await createProduct({ name, sku: `SKU-DUPNAME-B-${ts}`, price: 10, mrp: 20, categoryId })
      expect(a.status).toBe(201)
      expect(b.status).toBe(201)
      expect(a.body.slug).not.toBe(b.body.slug)
    })

    it('rejects a malformed product ID on read with 404', async () => {
      const res = await request(app).get('/api/v1/products/not-a-uuid')
      expect(res.status).toBe(404)
    })

    it('rejects a malformed product ID on update with 404', async () => {
      const res = await request(app).patch('/api/v1/admin/products/not-a-uuid').set(auth(adminToken)).send({ price: 5 })
      expect(res.status).toBe(404)
    })

    it('rejects a malformed product ID on delete with 404', async () => {
      const res = await request(app).delete('/api/v1/admin/products/not-a-uuid').set(auth(adminToken))
      expect(res.status).toBe(404)
    })

    it('rejects an update pointing at a non-existent category', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${productId}`)
        .set(auth(adminToken))
        .send({ categoryId: '00000000-0000-0000-0000-000000000000' })
      expect(res.status).toBe(400)
    })

    it('rejects an update to a SKU already used by another product with 409', async () => {
      const other = await createProduct({ name: `Other SKU Holder ${ts}`, sku: `SKU-OTHER-${ts}`, price: 10, mrp: 20, categoryId })
      expect(other.status).toBe(201)
      const res = await request(app).patch(`/api/v1/admin/products/${other.body.id}`).set(auth(adminToken)).send({ sku: productSku })
      expect(res.status).toBe(409)
    })
  })

  // =========================================================================
  // 3. PRODUCT ATTRIBUTES, PRICING, DISCOUNT & STOCK STATES
  // =========================================================================
  describe('Product attributes, pricing and stock states', () => {
    it('creates a fully-specified product and persists its attributes', async () => {
      const res = await createProduct({
        name: `Full Attributes ${ts}`,
        sku: `SKU-FULL-${ts}`,
        categoryId,
        description: 'A complete description',
        shortDescription: 'Short summary',
        price: 100,
        mrp: 150,
        unit: '500 g',
        netWeight: 500,
        shelfLife: '9 Months',
        storage: 'Cool and dry',
        ingredients: ['Foxtail Millet', 'Sea Salt'],
        allergens: ['None'],
        nutrition: [{ label: 'Energy', value: '350 kcal' }],
        tags: ['millet', 'healthy'],
        stock: 40,
      })
      expect(res.status).toBe(201)
      expect(res.body.description).toBe('A complete description')
      expect(res.body.unit).toBe('500 g')
      expect(res.body.ingredients).toContain('Foxtail Millet')
      expect(res.body.nutrition[0].label).toBe('Energy')
      expect(res.body.discount).toBe(50)
      expect(res.body.stock).toBe(40)
    })

    it('honours an explicitly supplied discount value', async () => {
      const res = await createProduct({
        name: `Explicit Discount ${ts}`,
        sku: `SKU-DISC-${ts}`,
        categoryId,
        price: 180,
        mrp: 200,
        discount: 35,
      })
      expect(res.status).toBe(201)
      expect(res.body.discount).toBe(35)
    })

    it('creates an out-of-stock product with OUT_OF_STOCK availability', async () => {
      const res = await createProduct({
        name: `Out Of Stock ${ts}`,
        sku: `SKU-OOS-${ts}`,
        categoryId,
        price: 120,
        mrp: 150,
        stock: 0,
      })
      expect(res.status).toBe(201)
      expect(res.body.stock).toBe(0)
      expect(res.body.availability).toBe('OUT_OF_STOCK')
      expect(res.body.isAvailable).toBe(false)
      const inv = await prisma.inventory.findUnique({ where: { productId: res.body.id } })
      expect(inv?.status).toBe('OUT_OF_STOCK')
      expect(inv?.availableQuantity).toBe(0)
    })

    it('transitions a product to out-of-stock through an update', async () => {
      const created = await createProduct({ name: `Stock Transition ${ts}`, sku: `SKU-TRANS-${ts}`, categoryId, price: 100, mrp: 120, stock: 25 })
      expect(created.status).toBe(201)
      const res = await request(app).patch(`/api/v1/admin/products/${created.body.id}`).set(auth(adminToken)).send({ stock: 0 })
      expect(res.status).toBe(200)
      expect(res.body.availability).toBe('OUT_OF_STOCK')
      expect(res.body.stock).toBe(0)
    })

    it('rejects an update that raises price above MRP', async () => {
      const res = await request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ price: 9999 })
      expect(res.status).toBe(400)
    })

    it('rejects an update with a negative price', async () => {
      const res = await request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ price: -1 })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // 4. PRODUCT ACTIVATION / DEACTIVATION & ARCHIVE
  // =========================================================================
  describe('Product activation lifecycle', () => {
    it('hides a deactivated product from the public catalog and restores it', async () => {
      const off = await request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ isActive: false })
      expect(off.status).toBe(200)
      expect(off.body.active).toBe(false)

      const hidden = await request(app).get(`/api/v1/products/${productId}`)
      expect(hidden.status).toBe(404)

      const on = await request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ isActive: true })
      expect(on.status).toBe(200)
      expect(on.body.active).toBe(true)

      const visible = await request(app).get(`/api/v1/products/${productId}`)
      expect(visible.status).toBe(200)
    })

    it('supports the legacy `active` flag on update', async () => {
      const res = await request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ active: false })
      expect(res.status).toBe(200)
      expect(res.body.active).toBe(false)
      await request(app).patch(`/api/v1/admin/products/${productId}`).set(auth(adminToken)).send({ active: true })
    })
  })

  // =========================================================================
  // 5. CATEGORY CRUD, DUPLICATION & REFERENCES
  // =========================================================================
  describe('Category CRUD, duplication and references', () => {
    it('updates a category and then deletes an empty category', async () => {
      const created = await createCategory(`Temp Category ${ts}`, { accent: '#ABCDEF' })
      expect(created.status).toBe(201)
      const updated = await request(app)
        .patch(`/api/v1/admin/categories/${created.body.id}`)
        .set(auth(adminToken))
        .send({ tagline: 'Updated tagline', sortOrder: 9 })
      expect(updated.status).toBe(200)
      expect(updated.body.tagline).toBe('Updated tagline')
      expect(updated.body.sortOrder).toBe(9)

      const deleted = await request(app).delete(`/api/v1/admin/categories/${created.body.id}`).set(auth(adminToken))
      expect(deleted.status).toBe(200)
      expect(deleted.body.success).toBe(true)
    })

    it('rejects a duplicate category name case-insensitively with 409', async () => {
      const name = `Case Dup ${ts}`
      const first = await createCategory(name)
      expect(first.status).toBe(201)
      const dup = await createCategory(name.toUpperCase())
      expect(dup.status).toBe(409)
    })

    it('rejects a duplicate explicit category slug with 409', async () => {
      const created = await createCategory(`Slug Source ${ts}`, { slug: `slug-source-${ts}` })
      expect(created.status).toBe(201)
      const dup = await createCategory(`Slug Target ${ts}`, { slug: `slug-source-${ts}` })
      expect(dup.status).toBe(409)
    })

    it('rejects deletion of a category that contains products with 400', async () => {
      const res = await request(app).delete(`/api/v1/admin/categories/${categoryId}`).set(auth(adminToken))
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('product')
    })

    it('rejects a non-existent parent category with 400', async () => {
      const res = await createCategory(`Orphan Parent ${ts}`, { parentId: '00000000-0000-0000-0000-000000000000' })
      expect(res.status).toBe(400)
    })

    it('rejects a malformed parent category UUID with 400', async () => {
      const res = await createCategory(`Bad Parent ${ts}`, { parentId: 'not-a-uuid' })
      expect(res.status).toBe(400)
    })

    it('rejects an over-long category name with 400', async () => {
      const res = await createCategory('C'.repeat(101))
      expect(res.status).toBe(400)
    })

    it('rejects an invalid accent colour with 400', async () => {
      const res = await createCategory(`Bad Accent ${ts}`, { accent: 'not-a-colour' })
      expect(res.status).toBe(400)
    })

    it('returns 404 for an unknown category slug', async () => {
      const res = await request(app).get(`/api/v1/categories/no-such-category-${ts}`)
      expect(res.status).toBe(404)
    })

    it('returns 404 when updating a non-existent category', async () => {
      const res = await request(app).patch('/api/v1/admin/categories/00000000-0000-0000-0000-000000000000').set(auth(adminToken)).send({ tagline: 'x' })
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 6. IMAGE UPLOAD — PRESIGNED URL VALIDATION
  // =========================================================================
  describe('Image presigned URL validation', () => {
    it('generates a presigned URL for a valid image request', async () => {
      const res = await presign(productId, { filename: 'front.webp', contentType: 'image/webp', sizeBytes: 1024 })
      expect(res.status).toBe(200)
      expect(res.body.uploadUrl).toContain('http')
      expect(res.body.s3Key).toMatch(new RegExp(`^products/${productId}/\\d+-[0-9a-f-]{36}\\.webp$`))
    })

    it('rejects SVG uploads (stored XSS vector)', async () => {
      const res = await presign(productId, { filename: 'logo.svg', contentType: 'image/svg+xml' })
      expect(res.status).toBe(400)
    })

    it('rejects HTML uploads', async () => {
      const res = await presign(productId, { filename: 'page.html', contentType: 'text/html' })
      expect(res.status).toBe(400)
    })

    it('rejects a PDF declared as an image', async () => {
      const res = await presign(productId, { filename: 'doc.pdf', contentType: 'application/pdf' })
      expect(res.status).toBe(400)
    })

    it('rejects an oversized declared file size', async () => {
      const res = await presign(productId, { filename: 'big.png', contentType: 'image/png', sizeBytes: 6 * 1024 * 1024 })
      expect(res.status).toBe(400)
    })

    it('rejects a path-traversal filename', async () => {
      const res = await presign(productId, { filename: '../../evil.png', contentType: 'image/png' })
      expect(res.status).toBe(400)
    })

    it('rejects a filename carrying a null byte or script payload', async () => {
      const nullByte = await presign(productId, { filename: 'evil\u0000.png', contentType: 'image/png' })
      expect(nullByte.status).toBe(400)
      const script = await presign(productId, { filename: '<script>.png', contentType: 'image/png' })
      expect(script.status).toBe(400)
    })

    it('derives the object key extension from the MIME type, not an executable filename', async () => {
      const res = await presign(productId, { filename: 'payload.php', contentType: 'image/jpeg' })
      expect(res.status).toBe(200)
      expect(res.body.s3Key.endsWith('.jpg')).toBe(true)
      expect(res.body.s3Key).not.toContain('.php')
    })

    it('returns 404 when presigning for a non-existent product', async () => {
      const res = await presign('00000000-0000-0000-0000-000000000000', { filename: 'x.png', contentType: 'image/png' })
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 7. IMAGE ATTACHMENT, ORDERING, REPLACE & DUPLICATION
  // =========================================================================
  describe('Image attachment, ordering, replacement and duplication', () => {
    it('attaches a verified image and auto-assigns it as primary', async () => {
      const p = await presign(productId, { filename: 'a.webp', contentType: 'image/webp' })
      const res = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: p.body.fileUrl, s3Key: p.body.s3Key, altText: 'A', displayOrder: 0 })
      expect(res.status).toBe(201)
      expect(res.body.isPrimary).toBe(true)
    })

    it('rejects an image with no s3Key (direct URL attachment is disallowed)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: 'https://evil.example.com/pixel.png' })
      expect(res.status).toBe(400)
    })

    it('rejects a foreign s3Key that belongs to another product with 400', async () => {
      const other = await createProduct({ name: `Img Other ${ts}`, sku: `SKU-IMGOTHER-${ts}`, categoryId, price: 10, mrp: 20 })
      expect(other.status).toBe(201)
      const foreignKey = (await presign(other.body.id, { filename: 'f.png', contentType: 'image/png' })).body.s3Key

      const res = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: 'https://example.com/f.png', s3Key: foreignKey })
      expect(res.status).toBe(400)
    })

    it('rejects a path-traversal s3Key with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: 'https://example.com/x.png', s3Key: 'products/../../etc/passwd' })
      expect(res.status).toBe(400)
    })

    it('rejects a duplicate s3Key attachment with 409', async () => {
      const p = await presign(productId, { filename: 'dup.png', contentType: 'image/png' })
      const first = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: p.body.fileUrl, s3Key: p.body.s3Key })
      expect(first.status).toBe(201)
      const second = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: p.body.fileUrl, s3Key: p.body.s3Key })
      expect(second.status).toBe(409)
    })

    it('reorders images and rejects foreign image IDs', async () => {
      const p1 = await presign(productId, { filename: 'r1.png', contentType: 'image/png' })
      const p2 = await presign(productId, { filename: 'r2.png', contentType: 'image/png' })
      const i1 = await request(app).post(`/api/v1/admin/products/${productId}/images`).set(auth(adminToken)).send({ imageUrl: p1.body.fileUrl, s3Key: p1.body.s3Key })
      const i2 = await request(app).post(`/api/v1/admin/products/${productId}/images`).set(auth(adminToken)).send({ imageUrl: p2.body.fileUrl, s3Key: p2.body.s3Key, isPrimary: false })
      expect(i1.status).toBe(201)
      expect(i2.status).toBe(201)

      const ok = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/reorder`)
        .set(auth(adminToken))
        .send({ images: [{ imageId: i1.body.id, displayOrder: 3 }, { imageId: i2.body.id, displayOrder: 1 }] })
      expect(ok.status).toBe(200)

      const foreign = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/reorder`)
        .set(auth(adminToken))
        .send({ images: [{ imageId: '00000000-0000-0000-0000-000000000000', displayOrder: 1 }] })
      expect(foreign.status).toBe(400)
    })

    it('replaces an image by deleting the old one after attaching the new one', async () => {
      const oldKey = (await presign(productId, { filename: 'old.png', contentType: 'image/png' })).body
      const attached = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(adminToken))
        .send({ imageUrl: oldKey.fileUrl, s3Key: oldKey.s3Key, altText: 'old' })
      expect(attached.status).toBe(201)

      const del = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/${attached.body.id}`)
        .set(auth(adminToken))
      expect(del.status).toBe(200)
      const gone = await prisma.productImage.findUnique({ where: { id: attached.body.id } })
      expect(gone).toBeNull()
    })

    it('returns 404 when deleting an unknown image', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`)
        .set(auth(adminToken))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 8. IMAGE AUTHORIZATION BOUNDARIES
  // =========================================================================
  describe('Image authorization boundaries', () => {
    it('forbids a customer from generating a presigned upload URL', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/products/${productId}/images/presigned-url`)
        .set(auth(customerToken))
        .send({ filename: 'x.png', contentType: 'image/png' })
      expect(res.status).toBe(403)
    })

    it('forbids a customer from deleting an image', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`)
        .set(auth(customerToken))
      expect(res.status).toBe(403)
    })

    it('allows staff (products.update) to attach an image but forbids products.delete', async () => {
      const p = await presign(productId, { filename: 'staff.png', contentType: 'image/png' })
      const attached = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .set(auth(staffToken))
        .send({ imageUrl: p.body.fileUrl, s3Key: p.body.s3Key })
      expect(attached.status).toBe(201)

      const del = await request(app)
        .delete(`/api/v1/admin/products/${productId}`)
        .set(auth(staffToken))
      expect(del.status).toBe(403)
    })

    it('rejects an unauthenticated image deletion with 401', async () => {
      const res = await request(app).delete(`/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`)
      expect(res.status).toBe(401)
    })
  })

  // =========================================================================
  // 9. CREDENTIAL / INTERNAL DATA EXPOSURE
  // =========================================================================
  describe('Credential and internal data exposure', () => {
    const forbidden = ['AWS_SECRET_ACCESS_KEY', 'secretAccessKey', 'aws_secret_access_key', 'ENCRYPTION_KEY', 'JWT_SECRET']

    it('never leaks secrets in the presigned-url response', async () => {
      const res = await presign(productId, { filename: 'sec.png', contentType: 'image/png' })
      const raw = JSON.stringify(res.body)
      for (const token of forbidden) expect(raw).not.toContain(token)
      expect(raw).not.toContain(process.env.JWT_SECRET || 'x-none-x')
    })

    it('never leaks secrets in the admin product response', async () => {
      const res = await request(app).get(`/api/v1/admin/products/${productId}`).set(auth(adminToken))
      expect(res.status).toBe(200)
      const raw = JSON.stringify(res.body)
      for (const token of forbidden) expect(raw).not.toContain(token)
    })

    it('never exposes internal storage fields on the public product payload', async () => {
      const res = await request(app).get(`/api/v1/products/${productId}`)
      expect(res.status).toBe(200)
      const raw = JSON.stringify(res.body)
      expect(raw).not.toContain('s3Key')
      expect(res.body).not.toHaveProperty('inventory')
      expect(res.body).not.toHaveProperty('isDeleted')
    })
  })

  // =========================================================================
  // 10. S3 SERVICE BEHAVIOUR (URL GENERATION / GRACEFUL DEGRADATION)
  // =========================================================================
  describe('S3 service behaviour', () => {
    it('builds a public URL without embedding credentials', () => {
      const url = S3Service.buildPublicUrl(`products/${productId}/1-00000000-0000-0000-0000-000000000000.png`)
      expect(url.startsWith('https://')).toBe(true)
      expect(url).not.toContain('@')
      expect(url).not.toContain('AWSAccessKeyId')
    })

    it('simulates a delete in the test environment without throwing', async () => {
      await expect(S3Service.deleteFile(`products/${productId}/ghost.png`)).resolves.toBe(true)
    })

    it('generates a presigned download URL in the test environment', async () => {
      const url = await S3Service.generatePresignedDownloadUrl(`products/${productId}/ghost.png`)
      expect(url).toContain('http')
    })
  })
})
