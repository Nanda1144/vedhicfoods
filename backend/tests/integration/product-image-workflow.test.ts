import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'
import { ensureDemoCustomer, DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_PASSWORD } from './helpers/demo-user'

/**
 * End-to-end product-image workflow.
 *
 * This suite drives the real Express app + PostgreSQL + the (simulated, in
 * NODE_ENV=test) S3 layer through the public admin image routes, and asserts the
 * persisted `ProductImage` rows *and* the public product projection. It is the
 * behavioural counterpart to the unit-level `product-image-failure` test: the
 * unit test covers cross-store compensation with a mocked Prisma, this one
 * proves the same routes and the DB partial-unique index behave correctly
 * against a migrated, seeded database.
 *
 * Coverage:
 *   - multiple images attach / first becomes primary
 *   - at-most-one-primary is enforced by the database
 *   - primary reassignment, gallery ordering / reorder
 *   - delete (including promotion of the next image when the primary is removed)
 *   - replacement (attach new + remove old)
 *   - presign rejects oversized declared sizes and invalid MIME types
 *   - attach rejects path-traversal keys and keys minted for another product
 *   - duplicate s3Key -> 409
 *   - authorization: customer 403, unauthenticated 401, staff allowed to write
 *     the gallery (products.update) but forbidden from deleting the product
 *   - the public product payload exposes the primary image + ordering and never
 *     leaks the internal storage key
 */

const app = createApp()
const ts = Date.now()

describe('Product Image Workflow (attach, primary, order, delete, replace, validation, authz)', () => {
  let adminToken: string
  let staffToken: string
  let customerToken: string

  let categoryId: string
  let productId: string
  let otherProductId: string

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

  function presign(pid: string, body: Record<string, any>, token: string = adminToken) {
    return request(app)
      .post(`/api/v1/admin/products/${pid}/images/presigned-url`)
      .set(auth(token))
      .send(body)
  }

  function attach(pid: string, body: Record<string, any>, token: string = adminToken) {
    return request(app)
      .post(`/api/v1/admin/products/${pid}/images`)
      .set(auth(token))
      .send(body)
  }

  /** Presign a valid image and attach it, returning the attach response. */
  async function attachValidImage(
    pid: string,
    options: { filename?: string; contentType?: string; altText?: string; isPrimary?: boolean; displayOrder?: number } = {},
  ) {
    const contentType = options.contentType ?? 'image/png'
    const p = await presign(pid, {
      filename: options.filename ?? `shot-${Math.random().toString(36).slice(2)}.png`,
      contentType,
    })
    expect(p.status).toBe(200)
    const res = await attach(pid, {
      imageUrl: p.body.fileUrl,
      s3Key: p.body.s3Key,
      altText: options.altText,
      isPrimary: options.isPrimary,
      displayOrder: options.displayOrder,
    })
    return { presign: p.body, res }
  }

  async function dbImages(pid: string) {
    return prisma.productImage.findMany({
      where: { productId: pid },
      orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
  }

  beforeAll(async () => {
    const admin = await AuthService.login({ email: 'admin@vedhicfoods.com', password: 'Admin@Vedhic2026' })
    adminToken = admin.accessToken
    const staff = await AuthService.login({ email: 'staff@vedhicfoods.com', password: 'Staff@Vedhic2026' })
    staffToken = staff.accessToken
    await ensureDemoCustomer()
    const customer = await AuthService.login({ email: DEMO_CUSTOMER_EMAIL, password: DEMO_CUSTOMER_PASSWORD })
    customerToken = customer.accessToken

    const cat = await createCategory(`Image Workflow ${ts}`, { accent: '#224466', sortOrder: 4 })
    expect(cat.status).toBe(201)
    categoryId = cat.body.id

    const a = await createProduct({
      name: `Image Workflow Product ${ts}`,
      sku: `SKU-IMGWF-${ts}`,
      categoryId,
      price: 199,
      mrp: 249,
      stock: 12,
      description: 'Product whose gallery is exercised by the image workflow suite.',
    })
    expect(a.status).toBe(201)
    productId = a.body.id

    const b = await createProduct({
      name: `Image Workflow Other ${ts}`,
      sku: `SKU-IMGWF-OTHER-${ts}`,
      categoryId,
      price: 99,
      mrp: 129,
      stock: 5,
    })
    expect(b.status).toBe(201)
    otherProductId = b.body.id
  }, 90000)

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
  // 1. MULTIPLE ATTACH + PRIMARY ASSIGNMENT
  // =========================================================================
  describe('multiple attachment and primary assignment', () => {
    let firstId: string
    let firstUrl: string
    let secondId: string
    let thirdId: string

    it('attaches several images in order and makes the first one primary', async () => {
      const one = await attachValidImage(productId, { altText: 'front', displayOrder: 0 })
      expect(one.res.status).toBe(201)
      expect(one.res.body.isPrimary).toBe(true)
      firstId = one.res.body.id
      firstUrl = one.res.body.imageUrl

      const two = await attachValidImage(productId, { altText: 'side', isPrimary: false, displayOrder: 1 })
      expect(two.res.status).toBe(201)
      expect(two.res.body.isPrimary).toBe(false)
      secondId = two.res.body.id

      const three = await attachValidImage(productId, { altText: 'back', isPrimary: false, displayOrder: 2 })
      expect(three.res.status).toBe(201)
      expect(three.res.body.isPrimary).toBe(false)
      thirdId = three.res.body.id

      const rows = await dbImages(productId)
      expect(rows).toHaveLength(3)
      expect(rows.filter((r) => r.isPrimary)).toHaveLength(1)
      expect(rows[0].id).toBe(firstId)
      expect(rows.map((r) => r.displayOrder)).toEqual([0, 1, 2])
    })

    it('exposes the primary image, gallery order and no storage key on the public product', async () => {
      const res = await request(app).get(`/api/v1/products/${productId}`)
      expect(res.status).toBe(200)
      expect(res.body.primaryImage).toBe(firstUrl)
      expect(res.body.images).toHaveLength(3)
      expect(res.body.gallery.map((g: any) => g.id)).toEqual([firstId, secondId, thirdId])
      expect(res.body.gallery.map((g: any) => g.displayOrder)).toEqual([0, 1, 2])
      expect(res.body.gallery[0].isPrimary).toBe(true)

      const raw = JSON.stringify(res.body)
      expect(raw).not.toContain('s3Key')
      expect(raw).not.toContain('"s3Key"')
      expect(res.body).not.toHaveProperty('inventory')
      expect(res.body).not.toHaveProperty('isDeleted')
      for (const entry of res.body.gallery) {
        expect(Object.keys(entry).sort()).toEqual(['altText', 'displayOrder', 'id', 'imageUrl', 'isPrimary'])
      }
    })
  })

  // =========================================================================
  // 2. AT-MOST-ONE-PRIMARY DATABASE CONSTRAINT
  // =========================================================================
  describe('at-most-one-primary database constraint', () => {
    it('refuses a second primary row for the same product at the database level', async () => {
      await prisma.productImage.updateMany({ where: { productId: otherProductId }, data: { isPrimary: false } })
      await prisma.productImage.create({
        data: { productId: otherProductId, imageUrl: 'https://media.example/constraint-a.png', isPrimary: true, displayOrder: 0 },
      })

      await expect(
        prisma.productImage.create({
          data: { productId: otherProductId, imageUrl: 'https://media.example/constraint-b.png', isPrimary: true, displayOrder: 1 },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    })
  })

  // =========================================================================
  // 3. PRESIGN VALIDATION (SIZE + MIME)
  // =========================================================================
  describe('presign validation', () => {
    it('generates a key scoped to the product for a valid image', async () => {
      const res = await presign(productId, { filename: 'valid.webp', contentType: 'image/webp', sizeBytes: 2048 })
      expect(res.status).toBe(200)
      expect(res.body.uploadUrl).toContain('http')
      expect(res.body.s3Key).toMatch(new RegExp(`^products/${productId}/\\d+-[0-9a-f-]{36}\\.webp$`))
    })

    it('rejects an oversized declared size', async () => {
      const res = await presign(productId, { filename: 'big.png', contentType: 'image/png', sizeBytes: 6 * 1024 * 1024 })
      expect(res.status).toBe(400)
    })

    it('rejects a PDF declared as an image', async () => {
      const res = await presign(productId, { filename: 'doc.pdf', contentType: 'application/pdf' })
      expect(res.status).toBe(400)
    })

    it('rejects HTML and SVG payloads', async () => {
      const html = await presign(productId, { filename: 'page.html', contentType: 'text/html' })
      expect(html.status).toBe(400)
      const svg = await presign(productId, { filename: 'logo.svg', contentType: 'image/svg+xml' })
      expect(svg.status).toBe(400)
    })
  })

  // =========================================================================
  // 4. ATTACH KEY VALIDATION (TRAVERSAL / FOREIGN / DUPLICATE)
  // =========================================================================
  describe('attach key validation', () => {
    it('rejects an attach with no s3Key at all', async () => {
      const res = await attach(productId, { imageUrl: 'https://evil.example.com/pixel.png' })
      expect(res.status).toBe(400)
    })

    it('rejects a path-traversal s3Key', async () => {
      const res = await attach(productId, {
        imageUrl: 'https://example.com/x.png',
        s3Key: 'products/../../etc/passwd',
      })
      expect(res.status).toBe(400)
    })

    it('rejects a foreign s3Key minted for another product', async () => {
      const foreign = await presign(otherProductId, { filename: 'foreign.png', contentType: 'image/png' })
      expect(foreign.status).toBe(200)
      const res = await attach(productId, {
        imageUrl: foreign.body.fileUrl,
        s3Key: foreign.body.s3Key,
      })
      expect(res.status).toBe(400)
      const leaked = await prisma.productImage.findFirst({ where: { productId, s3Key: foreign.body.s3Key } })
      expect(leaked).toBeNull()
    })

    it('rejects attaching the same s3Key twice with 409', async () => {
      const p = await presign(productId, { filename: 'dup.png', contentType: 'image/png' })
      const first = await attach(productId, { imageUrl: p.body.fileUrl, s3Key: p.body.s3Key })
      expect(first.status).toBe(201)
      const second = await attach(productId, { imageUrl: p.body.fileUrl, s3Key: p.body.s3Key })
      expect(second.status).toBe(409)

      const rows = await prisma.productImage.findMany({ where: { productId, s3Key: p.body.s3Key } })
      expect(rows).toHaveLength(1)
    })
  })

  // =========================================================================
  // 5. PRIMARY REASSIGNMENT
  // =========================================================================
  describe('primary reassignment', () => {
    it('promotes the requested image and demotes the previous primary (DB + public)', async () => {
      const before = await dbImages(productId)
      expect(before.length).toBeGreaterThanOrEqual(2)
      const currentPrimary = before.find((r) => r.isPrimary)!
      const target = before.find((r) => !r.isPrimary)!

      const res = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/${target.id}/primary`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const after = await dbImages(productId)
      expect(after.filter((r) => r.isPrimary)).toHaveLength(1)
      expect(after.find((r) => r.id === target.id)?.isPrimary).toBe(true)
      expect(after.find((r) => r.id === currentPrimary.id)?.isPrimary).toBe(false)

      const pub = await request(app).get(`/api/v1/products/${productId}`)
      expect(pub.status).toBe(200)
      expect(pub.body.primaryImage).toBe(target.imageUrl)
    })

    it('returns 404 when promoting an unknown image', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000/primary`)
        .set(auth(adminToken))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 6. ORDERING / REORDER
  // =========================================================================
  describe('ordering and reorder', () => {
    it('updates displayOrder and the public gallery order', async () => {
      const rows = await dbImages(productId)
      expect(rows.length).toBeGreaterThanOrEqual(3)
      const [primary, ...rest] = rows

      // Reverse the display order of every non-primary image.
      const reversed = rest.map((row, index) => ({ imageId: row.id, displayOrder: 100 + (rest.length - index) }))
      const res = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/reorder`)
        .set(auth(adminToken))
        .send({ images: reversed })
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const reordered = await dbImages(productId)
      expect(reordered[0].id).toBe(primary.id)
      const expectedOrder = reordered.map((r) => r.displayOrder)
      expect(expectedOrder).toEqual([...expectedOrder].sort((a, b) => a - b))

      const pub = await request(app).get(`/api/v1/products/${productId}`)
      expect(pub.status).toBe(200)
      expect(pub.body.gallery.map((g: any) => g.displayOrder)).toEqual(expectedOrder)
    })

    it('rejects a reorder referencing an image that does not belong to the product', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/reorder`)
        .set(auth(adminToken))
        .send({ images: [{ imageId: '00000000-0000-0000-0000-000000000000', displayOrder: 1 }] })
      expect(res.status).toBe(400)
    })

    it('rejects a malformed reorder payload', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/reorder`)
        .set(auth(adminToken))
        .send({ images: [] })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // 7. DELETE + PRIMARY PROMOTION
  // =========================================================================
  describe('delete and primary promotion', () => {
    it('deletes a non-primary image and shrinks the gallery', async () => {
      const rows = await dbImages(productId)
      const victim = rows.find((r) => !r.isPrimary)!
      const before = rows.length

      const res = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/${victim.id}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const gone = await prisma.productImage.findUnique({ where: { id: victim.id } })
      expect(gone).toBeNull()
      expect((await dbImages(productId)).length).toBe(before - 1)
    })

    it('promotes the next image when the primary image is deleted', async () => {
      const rows = await dbImages(productId)
      const primary = rows.find((r) => r.isPrimary)!
      const nextCandidate = rows.find((r) => !r.isPrimary)!

      const res = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/${primary.id}`)
        .set(auth(adminToken))
      expect(res.status).toBe(200)

      const after = await dbImages(productId)
      expect(after.filter((r) => r.isPrimary)).toHaveLength(1)
      expect(after.find((r) => r.id === nextCandidate.id)?.isPrimary).toBe(true)

      const pub = await request(app).get(`/api/v1/products/${productId}`)
      expect(pub.body.primaryImage).toBe(nextCandidate.imageUrl)
    })

    it('returns 404 when deleting an unknown image', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`)
        .set(auth(adminToken))
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 8. REPLACEMENT (ATTACH NEW + REMOVE OLD)
  // =========================================================================
  describe('replacement', () => {
    it('replaces an image by attaching a new one and deleting the old one', async () => {
      const oldRows = await dbImages(productId)
      const oldImage = oldRows.find((r) => !r.isPrimary) ?? oldRows[0]

      const replacement = await attachValidImage(productId, { altText: 'replacement', isPrimary: oldImage.isPrimary })
      expect(replacement.res.status).toBe(201)
      const newId = replacement.res.body.id

      const del = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/${oldImage.id}`)
        .set(auth(adminToken))
      expect(del.status).toBe(200)

      expect(await prisma.productImage.findUnique({ where: { id: oldImage.id } })).toBeNull()
      const newRow = await prisma.productImage.findUnique({ where: { id: newId } })
      expect(newRow).not.toBeNull()
      expect(newRow!.altText).toBe('replacement')

      const rows = await dbImages(productId)
      expect(rows.filter((r) => r.isPrimary)).toHaveLength(1)
    })
  })

  // =========================================================================
  // 9. AUTHORIZATION BOUNDARIES
  // =========================================================================
  describe('authorization boundaries', () => {
    it('forbids a customer from presigning, attaching or deleting an image (403)', async () => {
      const pre = await presign(productId, { filename: 'c.png', contentType: 'image/png' }, customerToken)
      expect(pre.status).toBe(403)

      const create = await attach(productId, { imageUrl: 'https://example.com/c.png', s3Key: 'x' }, customerToken)
      expect(create.status).toBe(403)

      const del = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`)
        .set(auth(customerToken))
      expect(del.status).toBe(403)
    })

    it('rejects unauthenticated image mutations with 401', async () => {
      const pre = await request(app)
        .post(`/api/v1/admin/products/${productId}/images/presigned-url`)
        .send({ filename: 'x.png', contentType: 'image/png' })
      expect(pre.status).toBe(401)

      const create = await request(app)
        .post(`/api/v1/admin/products/${productId}/images`)
        .send({ imageUrl: 'https://example.com/x.png', s3Key: 'x' })
      expect(create.status).toBe(401)

      const del = await request(app).delete(
        `/api/v1/admin/products/${productId}/images/00000000-0000-0000-0000-000000000000`,
      )
      expect(del.status).toBe(401)
    })

    it('allows staff (products.update) to attach, reorder and delete a gallery image', async () => {
      const p = await presign(productId, { filename: 'staff.png', contentType: 'image/png' }, staffToken)
      expect(p.status).toBe(200)

      const created = await attach(
        productId,
        { imageUrl: p.body.fileUrl, s3Key: p.body.s3Key, altText: 'staff upload' },
        staffToken,
      )
      expect(created.status).toBe(201)
      const imageId = created.body.id

      const reorder = await request(app)
        .patch(`/api/v1/admin/products/${productId}/images/reorder`)
        .set(auth(staffToken))
        .send({ images: [{ imageId, displayOrder: 42 }] })
      expect(reorder.status).toBe(200)

      const del = await request(app)
        .delete(`/api/v1/admin/products/${productId}/images/${imageId}`)
        .set(auth(staffToken))
      expect(del.status).toBe(200)
      expect(await prisma.productImage.findUnique({ where: { id: imageId } })).toBeNull()
    })

    it('forbids staff (no products.delete) from deleting the product itself', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/products/${otherProductId}`)
        .set(auth(staffToken))
      expect(res.status).toBe(403)

      const stillThere = await prisma.product.findUnique({ where: { id: otherProductId } })
      expect(stillThere).not.toBeNull()
    })
  })
})
