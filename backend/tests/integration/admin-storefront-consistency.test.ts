import './_safety'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { AuthService } from '../../src/services/auth.service'
import { prisma } from '../../src/config/database'
import {
  ensureDemoCustomer,
  DEMO_CUSTOMER_EMAIL,
  DEMO_CUSTOMER_PASSWORD,
} from './helpers/demo-user'
import { __setCacheClientForTests, __resetCacheForTests } from '../../src/utils/cache'
import {
  PRODUCT_LIST_CACHE_PREFIX,
  PRODUCT_DETAIL_CACHE_PREFIX,
} from '../../src/utils/catalog-cache'

/**
 * Admin console <-> customer storefront consistency.
 *
 * Every scenario drives a mutation through an ADMIN endpoint and then asserts
 * that the three views that must never disagree actually agree:
 *
 *   1. the ADMIN API response / admin console payload,
 *   2. the persisted PostgreSQL rows (products + inventories),
 *   3. the unauthenticated PUBLIC storefront (product detail + category listing).
 *
 * `NODE_ENV=test` leaves `REDIS_URL` unset, so the catalogue cache is a
 * pass-through and a stale read would be a genuine bug rather than a cache
 * artefact. A dedicated cache section injects a stateful fake Redis to prove
 * that the ADMIN mutation paths actually invalidate the public keys, so the very
 * next storefront read recomputes instead of serving the previous payload.
 *
 * The test database is shared and never truncated: every fixture uses a
 * run-unique name/SKU and is removed in `afterAll`. Public visibility is
 * asserted through the category-scoped listing so the result is independent of
 * the seeded dev catalogue and of every other suite.
 */
const app = createApp()
const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

describe('Admin console <-> storefront consistency', () => {
  let adminToken = ''
  let customerToken = ''
  let categoryId = ''
  let customerAddressId = ''

  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdOrderIds: string[] = []
  const createdAddressIds: string[] = []

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function createProduct(body: Record<string, any>) {
    const res = await request(app).post('/api/v1/admin/products').set(auth(adminToken)).send(body)
    if (res.status === 201 && res.body?.id) createdProductIds.push(res.body.id)
    return res
  }

  async function patchProduct(id: string, body: Record<string, any>) {
    return request(app).patch(`/api/v1/admin/products/${id}`).set(auth(adminToken)).send(body)
  }

  async function adjustStock(id: string, body: Record<string, any>) {
    return request(app)
      .post(`/api/v1/admin/inventory/${id}/adjust`)
      .set(auth(adminToken))
      .send(body)
  }

  const publicDetail = (idOrSlug: string) => request(app).get(`/api/v1/products/${idOrSlug}`)
  const adminProduct = (id: string) =>
    request(app).get(`/api/v1/admin/products/${id}`).set(auth(adminToken))
  const adminInventory = (id: string) =>
    request(app).get(`/api/v1/admin/inventory/${id}`).set(auth(adminToken))

  async function publicListing(): Promise<any[]> {
    const res = await request(app).get(`/api/v1/products?category=${categoryId}&per_page=100`)
    expect(res.status).toBe(200)
    return res.body.items as any[]
  }

  async function findInListing(id: string): Promise<any | undefined> {
    return (await publicListing()).find((p) => p.id === id)
  }

  async function dbProduct(id: string) {
    return prisma.product.findUnique({ where: { id }, include: { inventory: true } })
  }

  beforeAll(async () => {
    const admin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = admin.accessToken

    await ensureDemoCustomer()
    const customer = await AuthService.login({
      email: DEMO_CUSTOMER_EMAIL,
      password: DEMO_CUSTOMER_PASSWORD,
    })
    customerToken = customer.accessToken

    const cat = await request(app)
      .post('/api/v1/admin/categories')
      .set(auth(adminToken))
      .send({ name: `Consistency ${ts}`, accent: '#334455' })
    expect(cat.status).toBe(201)
    categoryId = cat.body.id
    createdCategoryIds.push(categoryId)

    const addr = await request(app)
      .post('/api/v1/customer/addresses')
      .set(auth(customerToken))
      .send({
        fullName: 'Consistency Customer',
        phone: '9876543210',
        line1: 'Flat 1, Consistency Towers',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
      })
    expect(addr.status).toBe(201)
    customerAddressId = addr.body.data.id
    createdAddressIds.push(customerAddressId)
  }, 60000)

  afterAll(async () => {
    const orderIds = [...new Set(createdOrderIds)]
    if (orderIds.length > 0) {
      await prisma.deliveryHistory
        .deleteMany({ where: { delivery: { orderId: { in: orderIds } } } })
        .catch(() => {})
      await prisma.invoice.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {})
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {})
    }

    const productIds = [...new Set(createdProductIds)]
    if (productIds.length > 0) {
      await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.couponProduct.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.promotionProduct.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
      await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    }

    if (createdAddressIds.length > 0) {
      await prisma.address.deleteMany({ where: { id: { in: createdAddressIds } } }).catch(() => {})
    }

    const categoryIds = [...new Set(createdCategoryIds)]
    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } }).catch(() => {})
    }
  })

  // =========================================================================
  // 1. ADMIN STOCK ADJUSTMENTS -> CUSTOMER STOCK / AVAILABILITY
  // =========================================================================
  describe('Admin inventory adjustment -> storefront stock', () => {
    it('ADD_STOCK raises stock in admin inventory, DB, detail and listing alike', async () => {
      const created = await createProduct({
        name: `Stock Add ${ts}`,
        sku: `SKU-CONS-ADD-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
        stock: 50,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const adjusted = await adjustStock(id, {
        operation: 'ADD_STOCK',
        quantity: 10,
        reason: 'consistency add',
      })
      expect(adjusted.status).toBe(200)
      expect(adjusted.body.availableQuantity).toBe(60)
      expect(adjusted.body.status).toBe('IN_STOCK')

      const adminView = await adminInventory(id)
      expect(adminView.status).toBe(200)
      expect(adminView.body.availableQuantity).toBe(60)
      expect(adminView.body.status).toBe('IN_STOCK')
      expect(adminView.body.product.stock).toBe(60)

      const detail = await publicDetail(id)
      expect(detail.status).toBe(200)
      expect(detail.body.stock).toBe(60)
      expect(detail.body.availability).toBe('IN_STOCK')
      expect(detail.body.isAvailable).toBe(true)

      const listed = await findInListing(id)
      expect(listed).toBeDefined()
      expect(listed!.stock).toBe(60)
      expect(listed!.availability).toBe('IN_STOCK')

      const row = await dbProduct(id)
      expect(row!.stock).toBe(60)
      expect(row!.inventory!.availableQuantity).toBe(60)
      expect(row!.inventory!.status).toBe('IN_STOCK')
    }, 40000)

    it('REMOVE_STOCK down to zero flips every view to out of stock', async () => {
      const created = await createProduct({
        name: `Stock Remove ${ts}`,
        sku: `SKU-CONS-REMOVE-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
        stock: 4,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const adjusted = await adjustStock(id, {
        operation: 'REMOVE_STOCK',
        quantity: 4,
        reason: 'consistency remove',
      })
      expect(adjusted.status).toBe(200)
      expect(adjusted.body.availableQuantity).toBe(0)
      expect(adjusted.body.status).toBe('OUT_OF_STOCK')

      const adminView = await adminInventory(id)
      expect(adminView.body.availableQuantity).toBe(0)
      expect(adminView.body.status).toBe('OUT_OF_STOCK')

      const detail = await publicDetail(id)
      expect(detail.status).toBe(200)
      expect(detail.body.stock).toBe(0)
      expect(detail.body.availability).toBe('OUT_OF_STOCK')
      expect(detail.body.isAvailable).toBe(false)

      const listed = await findInListing(id)
      expect(listed).toBeDefined()
      expect(listed!.stock).toBe(0)
      expect(listed!.availability).toBe('OUT_OF_STOCK')
      expect(listed!.isAvailable).toBe(false)

      const row = await dbProduct(id)
      expect(row!.stock).toBe(0)
      expect(row!.inventory!.availableQuantity).toBe(0)
      expect(row!.inventory!.status).toBe('OUT_OF_STOCK')
    }, 40000)

    it('MANUAL_ADJUSTMENT sets an absolute value and the low-stock views agree', async () => {
      const created = await createProduct({
        name: `Stock Manual ${ts}`,
        sku: `SKU-CONS-MANUAL-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
        stock: 50,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const adjusted = await adjustStock(id, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 7,
        reason: 'consistency manual',
      })
      expect(adjusted.status).toBe(200)
      expect(adjusted.body.availableQuantity).toBe(7)
      expect(adjusted.body.status).toBe('LOW_STOCK')

      const detail = await publicDetail(id)
      expect(detail.body.stock).toBe(7)
      expect(detail.body.availability).toBe('LOW_STOCK')

      const lowStock = await request(app)
        .get('/api/v1/admin/inventory/low-stock?limit=100')
        .set(auth(adminToken))
      expect(lowStock.status).toBe(200)
      expect(lowStock.body.items.some((i: any) => i.productId === id)).toBe(true)

      const row = await dbProduct(id)
      expect(row!.stock).toBe(7)
      expect(row!.inventory!.availableQuantity).toBe(7)
    }, 40000)

    it('admin product PATCH of stock keeps inventory, DB and storefront in sync', async () => {
      const created = await createProduct({
        name: `Stock Patch ${ts}`,
        sku: `SKU-CONS-PATCH-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
        stock: 3,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const patched = await patchProduct(id, { stock: 25 })
      expect(patched.status).toBe(200)
      expect(patched.body.stock).toBe(25)
      expect(patched.body.availability).toBe('IN_STOCK')

      const adminView = await adminInventory(id)
      expect(adminView.body.availableQuantity).toBe(25)

      const detail = await publicDetail(id)
      expect(detail.body.stock).toBe(25)
      expect(detail.body.availability).toBe('IN_STOCK')

      const row = await dbProduct(id)
      expect(row!.stock).toBe(25)
      expect(row!.inventory!.availableQuantity).toBe(25)
    }, 40000)
  })

  // =========================================================================
  // 2. ADMIN PRODUCT EDITS -> STOREFRONT DETAIL / LISTING
  // =========================================================================
  describe('Admin product edit -> storefront detail and listing', () => {
    it('price, derived discount, name and description edits are reflected publicly', async () => {
      const created = await createProduct({
        name: `Edit Before ${ts}`,
        sku: `SKU-CONS-EDIT-${ts}`,
        categoryId,
        price: 200,
        mrp: 300,
        stock: 12,
        description: 'Before edit',
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const updated = await patchProduct(id, {
        name: `Edit After ${ts}`,
        price: 150,
        description: 'After edit',
      })
      expect(updated.status).toBe(200)
      expect(updated.body.name).toBe(`Edit After ${ts}`)
      expect(updated.body.price).toBe(150)
      expect(updated.body.discount).toBe(150)

      const adminView = await adminProduct(id)
      expect(adminView.body.name).toBe(`Edit After ${ts}`)
      expect(adminView.body.price).toBe(150)
      expect(adminView.body.description).toBe('After edit')

      const detail = await publicDetail(id)
      expect(detail.status).toBe(200)
      expect(detail.body.name).toBe(`Edit After ${ts}`)
      expect(detail.body.price).toBe(150)
      expect(detail.body.discount).toBe(150)
      expect(detail.body.description).toBe('After edit')

      const listed = await findInListing(id)
      expect(listed).toBeDefined()
      expect(listed!.name).toBe(`Edit After ${ts}`)
      expect(listed!.price).toBe(150)
      expect(listed!.discount).toBe(150)

      const row = await dbProduct(id)
      expect(row!.name).toBe(`Edit After ${ts}`)
      expect(Number(row!.price)).toBe(150)
      expect(Number(row!.discount)).toBe(150)
      expect(row!.description).toBe('After edit')
    }, 40000)

    it('an explicit discount edit survives and is served to the storefront', async () => {
      const created = await createProduct({
        name: `Discount Before ${ts}`,
        sku: `SKU-CONS-DISC-${ts}`,
        categoryId,
        price: 100,
        mrp: 200,
        stock: 10,
      })
      expect(created.status).toBe(201)
      const id = created.body.id
      expect(created.body.discount).toBe(100)

      const updated = await patchProduct(id, { discount: 125 })
      expect(updated.status).toBe(200)
      expect(updated.body.discount).toBe(125)

      const detail = await publicDetail(id)
      expect(detail.body.discount).toBe(125)

      const listed = await findInListing(id)
      expect(listed!.discount).toBe(125)

      const row = await dbProduct(id)
      expect(Number(row!.discount)).toBe(125)
    }, 40000)
  })

  // =========================================================================
  // 3. ARCHIVE / DEACTIVATE VISIBILITY
  // =========================================================================
  describe('Admin archive / deactivate -> storefront visibility', () => {
    it('deactivate hides the product publicly and activate restores it', async () => {
      const created = await createProduct({
        name: `Visibility ${ts}`,
        sku: `SKU-CONS-VIS-${ts}`,
        categoryId,
        price: 90,
        mrp: 100,
        stock: 10,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      expect((await publicDetail(id)).status).toBe(200)
      expect((await findInListing(id))).toBeDefined()

      const off = await patchProduct(id, { isActive: false })
      expect(off.status).toBe(200)
      expect(off.body.active).toBe(false)

      const adminView = await adminProduct(id)
      expect(adminView.status).toBe(200)
      expect(adminView.body.active).toBe(false)

      expect((await publicDetail(id)).status).toBe(404)
      expect(await findInListing(id)).toBeUndefined()

      const row = await dbProduct(id)
      expect(row!.isActive).toBe(false)

      const on = await patchProduct(id, { isActive: true })
      expect(on.status).toBe(200)
      expect(on.body.active).toBe(true)
      expect((await publicDetail(id)).status).toBe(200)
      expect(await findInListing(id)).toBeDefined()
    }, 40000)

    it('ARCHIVED status hides the product publicly and PUBLISHED restores it', async () => {
      const created = await createProduct({
        name: `Archive Status ${ts}`,
        sku: `SKU-CONS-ARCH-${ts}`,
        categoryId,
        price: 60,
        mrp: 80,
        stock: 6,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const archived = await patchProduct(id, { status: 'ARCHIVED' })
      expect(archived.status).toBe(200)
      expect(archived.body.status).toBe('ARCHIVED')
      expect((await publicDetail(id)).status).toBe(404)
      expect(await findInListing(id)).toBeUndefined()

      const row = await dbProduct(id)
      expect(row!.status).toBe('ARCHIVED')

      const published = await patchProduct(id, { status: 'PUBLISHED' })
      expect(published.status).toBe(200)
      expect(published.body.status).toBe('PUBLISHED')
      expect((await publicDetail(id)).status).toBe(200)
      expect(await findInListing(id)).toBeDefined()
    }, 40000)
  })

  // =========================================================================
  // 4. CHECKOUT -> STOCK DECREASE AND CANCELLATION -> RESTOCK
  // =========================================================================
  describe('Checkout and cancellation inventory consistency', () => {
    it('a COD order decrements stock across admin inventory, DB and storefront', async () => {
      const created = await createProduct({
        name: `Order Stock ${ts}`,
        sku: `SKU-CONS-ORDER-${ts}`,
        categoryId,
        price: 350,
        mrp: 400,
        stock: 20,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const checkout = await request(app)
        .post('/api/v1/checkout')
        .set(auth(customerToken))
        .send({
          addressId: customerAddressId,
          items: [{ productId: id, quantity: 3 }],
          paymentMethod: 'COD',
        })
      expect(checkout.status).toBe(201)
      expect(checkout.body.status).toBe('CONFIRMED')
      const orderId = checkout.body.orderId
      createdOrderIds.push(orderId)

      const adminView = await adminInventory(id)
      expect(adminView.body.availableQuantity).toBe(17)
      expect(adminView.body.soldQuantity).toBe(3)
      expect(adminView.body.product.stock).toBe(17)

      const detail = await publicDetail(id)
      expect(detail.body.stock).toBe(17)
      expect(detail.body.availability).toBe('IN_STOCK')

      const listed = await findInListing(id)
      expect(listed!.stock).toBe(17)

      const row = await dbProduct(id)
      expect(row!.stock).toBe(17)
      expect(row!.inventory!.availableQuantity).toBe(17)
      expect(row!.inventory!.soldQuantity).toBe(3)
      expect(row!.inventory!.reservedQuantity).toBe(0)

      // Admin cancels the order from CONFIRMED -> restock to the original level.
      const cancelled = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set(auth(adminToken))
        .send({ status: 'CANCELLED' })
      expect(cancelled.status).toBe(200)

      const adminAfter = await adminInventory(id)
      expect(adminAfter.body.availableQuantity).toBe(20)
      expect(adminAfter.body.soldQuantity).toBe(0)
      expect(adminAfter.body.product.stock).toBe(20)

      const detailAfter = await publicDetail(id)
      expect(detailAfter.body.stock).toBe(20)
      expect(detailAfter.body.availability).toBe('IN_STOCK')

      const rowAfter = await dbProduct(id)
      expect(rowAfter!.stock).toBe(20)
      expect(rowAfter!.inventory!.availableQuantity).toBe(20)
      expect(rowAfter!.inventory!.soldQuantity).toBe(0)
    }, 60000)
  })

  // =========================================================================
  // 5. ADMIN DASHBOARD STOCK SUMMARY vs CUSTOMER STOREFRONT
  // =========================================================================
  describe('Admin dashboard stock summary agrees with the storefront', () => {
    it('low-stock figure tracks the customer-facing availability label', async () => {
      const before = await request(app).get('/api/v1/admin/dashboard').set(auth(adminToken))
      expect(before.status).toBe(200)
      const lowBefore = before.body.data.overview.lowStock

      const created = await createProduct({
        name: `Dashboard Stock ${ts}`,
        sku: `SKU-CONS-DASH-${ts}`,
        categoryId,
        price: 100,
        mrp: 120,
        stock: 5,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      const during = await request(app).get('/api/v1/admin/dashboard').set(auth(adminToken))
      expect(during.status).toBe(200)
      expect(during.body.data.overview.lowStock).toBe(lowBefore + 1)
      expect(during.body.data.lowStockCount).toBe(during.body.data.overview.lowStock)

      const lowList = await request(app)
        .get('/api/v1/admin/inventory/low-stock?limit=100')
        .set(auth(adminToken))
      expect(lowList.body.items.some((i: any) => i.productId === id)).toBe(true)

      const detail = await publicDetail(id)
      expect(detail.body.availability).toBe('LOW_STOCK')
      expect(detail.body.stock).toBe(5)

      const restocked = await adjustStock(id, {
        operation: 'ADD_STOCK',
        quantity: 100,
        reason: 'dashboard consistency restock',
      })
      expect(restocked.status).toBe(200)

      const after = await request(app).get('/api/v1/admin/dashboard').set(auth(adminToken))
      expect(after.status).toBe(200)
      expect(after.body.data.overview.lowStock).toBe(lowBefore)

      const lowListAfter = await request(app)
        .get('/api/v1/admin/inventory/low-stock?limit=100')
        .set(auth(adminToken))
      expect(lowListAfter.body.items.some((i: any) => i.productId === id)).toBe(false)

      const detailAfter = await publicDetail(id)
      expect(detailAfter.body.availability).toBe('IN_STOCK')
      expect(detailAfter.body.stock).toBe(105)
    }, 60000)
  })

  // =========================================================================
  // 6. CATALOGUE CACHE INVALIDATION ON ADMIN MUTATIONS
  //
  // A stateful fake Redis is injected so a public read genuinely populates the
  // cache. After each admin mutation the key must be gone, and the next public
  // read must return the fresh value (mirroring the real deployment where the
  // invalidation is what stops a stale storefront payload).
  // =========================================================================
  describe('Admin mutations invalidate the public catalogue cache', () => {
    type FakeRedis = {
      store: Map<string, string>
      get: (key: string) => Promise<string | null>
      set: (key: string, value: string) => Promise<string>
      del: (keys: string | string[]) => Promise<number>
      scan: (cursor: number, options: { MATCH?: string }) => Promise<{ cursor: number; keys: string[] }>
    }

    function createStatefulFakeRedis(): FakeRedis {
      const store = new Map<string, string>()
      return {
        store,
        get: async (key: string) => (store.has(key) ? store.get(key)! : null),
        set: async (key: string, value: string) => {
          store.set(key, value)
          return 'OK'
        },
        del: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys]
          let removed = 0
          for (const key of list) {
            if (store.delete(key)) removed += 1
          }
          return removed
        },
        scan: async (_cursor: number, options: { MATCH?: string }) => {
          const match = options?.MATCH ?? '*'
          const prefix = match.endsWith('*') ? match.slice(0, -1) : match
          return { cursor: 0, keys: [...store.keys()].filter((k) => k.startsWith(prefix)) }
        },
      }
    }

    let fake: FakeRedis

    beforeEach(() => {
      fake = createStatefulFakeRedis()
      __setCacheClientForTests(fake as any)
    })

    afterEach(() => {
      __resetCacheForTests()
    })

    it('product detail cache is invalidated by an admin price edit', async () => {
      const created = await createProduct({
        name: `Cache Edit ${ts}`,
        sku: `SKU-CONS-CACHE-EDIT-${ts}`,
        categoryId,
        price: 100,
        mrp: 200,
        stock: 10,
      })
      expect(created.status).toBe(201)
      const id = created.body.id
      const detailKey = `${PRODUCT_DETAIL_CACHE_PREFIX}public:${id.toLowerCase()}`

      const first = await publicDetail(id)
      expect(first.body.price).toBe(100)
      expect(fake.store.has(detailKey)).toBe(true)

      const updated = await patchProduct(id, { price: 150 })
      expect(updated.status).toBe(200)
      expect(fake.store.has(detailKey)).toBe(false)

      const second = await publicDetail(id)
      expect(second.body.price).toBe(150)
    }, 40000)

    it('product detail cache is invalidated by an admin stock adjustment', async () => {
      const created = await createProduct({
        name: `Cache Stock ${ts}`,
        sku: `SKU-CONS-CACHE-STOCK-${ts}`,
        categoryId,
        price: 100,
        mrp: 200,
        stock: 30,
      })
      expect(created.status).toBe(201)
      const id = created.body.id
      const detailKey = `${PRODUCT_DETAIL_CACHE_PREFIX}public:${id.toLowerCase()}`

      const first = await publicDetail(id)
      expect(first.body.stock).toBe(30)
      expect(fake.store.has(detailKey)).toBe(true)

      const adjusted = await adjustStock(id, {
        operation: 'ADD_STOCK',
        quantity: 5,
        reason: 'cache invalidation',
      })
      expect(adjusted.status).toBe(200)
      expect(fake.store.has(detailKey)).toBe(false)

      const second = await publicDetail(id)
      expect(second.body.stock).toBe(35)
    }, 40000)

    it('the listing cache is invalidated when a product is archived', async () => {
      const created = await createProduct({
        name: `Cache Archive ${ts}`,
        sku: `SKU-CONS-CACHE-ARCH-${ts}`,
        categoryId,
        price: 100,
        mrp: 200,
        stock: 10,
      })
      expect(created.status).toBe(201)
      const id = created.body.id

      expect(await findInListing(id)).toBeDefined()
      const listKeys = [...fake.store.keys()].filter((k) => k.startsWith(PRODUCT_LIST_CACHE_PREFIX))
      expect(listKeys.length).toBeGreaterThan(0)

      const archived = await patchProduct(id, { status: 'ARCHIVED' })
      expect(archived.status).toBe(200)
      expect(
        [...fake.store.keys()].some((k) => k.startsWith(PRODUCT_LIST_CACHE_PREFIX)),
      ).toBe(false)

      expect(await findInListing(id)).toBeUndefined()
    }, 40000)
  })
})
