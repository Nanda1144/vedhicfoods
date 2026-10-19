import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'

/**
 * Product lifecycle visibility.
 *
 * Pins the contract between an admin mutation and what the public storefront
 * can see in the SAME request cycle (REDIS_URL is unset under NODE_ENV=test,
 * so the cache wrapper is a pass-through and any staleness would be a real
 * bug, not a cache artefact):
 *
 *   - create -> immediately readable admin + public (by id and slug);
 *   - update -> immediately reflected publicly;
 *   - deactivate -> hidden publicly, still visible to admin; reactivate -> back;
 *   - DRAFT / ARCHIVED status -> hidden publicly;
 *   - delete -> soft-deleted (isDeleted, ARCHIVED, inactive), hidden publicly,
 *     still readable by an admin, excluded from the admin listing.
 */
const app = createApp()
const ts = Date.now()

describe('Product lifecycle visibility and DB-immediate reflection', () => {
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
      .send({ name: `Lifecycle ${ts}`, accent: '#334455' })
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

  describe('Create -> read (admin + public, id + slug)', () => {
    it('reflects a freshly created product in the same request cycle', async () => {
      const res = await createProduct({
        name: `Immediate Create ${ts}`,
        sku: `SKU-IMMEDIATE-${ts}`,
        categoryId,
        price: 120,
        mrp: 150,
        stock: 5,
      })
      expect(res.status).toBe(201)
      const { id, slug } = res.body

      const adminRead = await request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(adminRead.status).toBe(200)
      expect(adminRead.body.id).toBe(id)

      const publicById = await request(app).get(`/api/v1/products/${id}`)
      expect(publicById.status).toBe(200)
      expect(publicById.body.id).toBe(id)
      expect(publicById.body.name).toBe(`Immediate Create ${ts}`)

      const publicBySlug = await request(app).get(`/api/v1/products/slug/${slug}`)
      expect(publicBySlug.status).toBe(200)
      expect(publicBySlug.body.id).toBe(id)
    })
  })

  describe('Update -> immediate public reflection', () => {
    it('reflects an admin update on the very next public read', async () => {
      const created = await createProduct({
        name: `Immediate Update ${ts}`,
        sku: `SKU-IMM-UPD-${ts}`,
        categoryId,
        price: 100,
        mrp: 200,
      })
      expect(created.status).toBe(201)

      const updated = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({ name: `Immediate Update Renamed ${ts}`, price: 150, stock: 9 })
      expect(updated.status).toBe(200)

      const publicRead = await request(app).get(`/api/v1/products/${created.body.id}`)
      expect(publicRead.status).toBe(200)
      expect(publicRead.body.name).toBe(`Immediate Update Renamed ${ts}`)
      expect(publicRead.body.price).toBe(150)
      expect(publicRead.body.discount).toBe(50)
      expect(publicRead.body.stock).toBe(9)
    })
  })

  describe('Activate / deactivate flips public visibility', () => {
    it('hides a deactivated product publicly and restores it on reactivation', async () => {
      const created = await createProduct({
        name: `Visibility Toggle ${ts}`,
        sku: `SKU-VIS-TOGGLE-${ts}`,
        categoryId,
        price: 90,
        mrp: 100,
        stock: 10,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const off = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send({ isActive: false })
      expect(off.status).toBe(200)
      expect(off.body.active).toBe(false)

      const hiddenPublic = await request(app).get(`/api/v1/products/${id}`)
      expect(hiddenPublic.status).toBe(404)
      const hiddenAdmin = await request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(hiddenAdmin.status).toBe(200)
      expect(hiddenAdmin.body.active).toBe(false)

      const on = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send({ isActive: true })
      expect(on.status).toBe(200)
      expect(on.body.active).toBe(true)

      const visiblePublic = await request(app).get(`/api/v1/products/${id}`)
      expect(visiblePublic.status).toBe(200)
      expect(visiblePublic.body.id).toBe(id)
    })

    it('honours isActive:false supplied at creation', async () => {
      const created = await createProduct({
        name: `Created Inactive ${ts}`,
        sku: `SKU-CREATED-INACTIVE-${ts}`,
        categoryId,
        price: 90,
        mrp: 100,
        isActive: false,
      })
      expect(created.status).toBe(201)
      const publicRead = await request(app).get(`/api/v1/products/${created.body.id}`)
      expect(publicRead.status).toBe(404)
    })
  })

  describe('Status transitions (DRAFT / PUBLISHED / ARCHIVED)', () => {
    it('hides DRAFT and ARCHIVED, shows PUBLISHED', async () => {
      const created = await createProduct({
        name: `Status Product ${ts}`,
        sku: `SKU-STATUS-${ts}`,
        categoryId,
        price: 70,
        mrp: 100,
      })
      expect(created.status).toBe(201)
      const id = created.body.id
      expect(created.body.status).toBe('PUBLISHED')

      const draft = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send({ status: 'DRAFT' })
      expect(draft.status).toBe(200)
      expect(draft.body.status).toBe('DRAFT')
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)

      const published = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send({ status: 'PUBLISHED' })
      expect(published.status).toBe(200)
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(200)

      const archived = await request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send({ status: 'ARCHIVED' })
      expect(archived.status).toBe(200)
      expect(archived.body.status).toBe('ARCHIVED')
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)
    })

    it('rejects an unknown status value with 400', async () => {
      const created = await createProduct({
        name: `Bad Status ${ts}`,
        sku: `SKU-BADSTATUS-${ts}`,
        categoryId,
        price: 70,
        mrp: 100,
      })
      const res = await request(app)
        .patch(`/api/v1/admin/products/${created.body.id}`)
        .set(auth(adminToken))
        .send({ status: 'NOPE' })
      expect(res.status).toBe(400)
    })
  })

  describe('Soft delete / archive', () => {
    it('soft-deletes, hides publicly, keeps admin read, drops from admin listing', async () => {
      const created = await createProduct({
        name: `Soft Delete ${ts}`,
        sku: `SKU-SOFTDELETE-${ts}`,
        categoryId,
        price: 60,
        mrp: 80,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const del = await request(app).delete(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(del.status).toBe(200)
      expect(del.body.success).toBe(true)

      const dbRow = await prisma.product.findUnique({ where: { id } })
      expect(dbRow?.isDeleted).toBe(true)
      expect(dbRow?.status).toBe('ARCHIVED')
      expect(dbRow?.isActive).toBe(false)
      expect(dbRow?.deletedAt).not.toBeNull()

      // Gone from the public storefront...
      expect((await request(app).get(`/api/v1/products/${id}`)).status).toBe(404)

      // ...still inspectable by an admin, flagged as deleted...
      const adminRead = await request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
      expect(adminRead.status).toBe(200)
      expect(adminRead.body.isDeleted).toBe(true)

      // ...but excluded from the admin listing.
      const adminList = await request(app).get('/api/v1/admin/products?limit=100').set(auth(adminToken))
      expect(adminList.status).toBe(200)
      expect(adminList.body.items.some((p: any) => p.id === id)).toBe(false)
    })

    it('returns 404 when deleting an unknown product id', async () => {
      const res = await request(app)
        .delete('/api/v1/admin/products/00000000-0000-0000-0000-000000000000')
        .set(auth(adminToken))
      expect(res.status).toBe(404)
    })
  })
})
