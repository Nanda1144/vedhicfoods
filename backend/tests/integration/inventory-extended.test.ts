import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InventoryService } from '../../src/services/inventory.service'
import { InventoryStatus } from '@prisma/client'

const app = createApp()

const ts = Date.now()
const guestPhone = (n: number) => `9${String(ts).slice(-8)}${n}`

/**
 * Extended, adversarial integration coverage for the inventory subsystem.
 *
 * Covers the full stock lifecycle (add / remove / manual / restock), status
 * computation, guard rails, reservation lifecycle semantics, transaction
 * atomicity, concurrent oversell prevention, checkout integration (COD +
 * online reservation-only), audit trail integrity and RBAC — complementing the
 * existing `inventory.test.ts` smoke suite.
 */
describe('Inventory — Extended Lifecycle, Concurrency & Audit', () => {
  let adminToken: string
  let staffToken: string
  let restrictedStaffToken: string
  let customerToken: string
  let customerEmail: string
  let categoryId = ''
  const createdProductIds: string[] = []

  const createProduct = async (label: string, stock: number): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Inventory Extended ${label} ${ts}`,
        sku: `SKU-IEXT-${label}-${ts}`,
        price: 100,
        mrp: 120,
        stock,
        unit: 'piece',
        categoryId,
        shortDescription: `Extended inventory fixture ${label}`,
      })
    if (res.status !== 201) {
      throw new Error(`createProduct(${label}) failed ${res.status}: ${JSON.stringify(res.body)}`)
    }
    createdProductIds.push(res.body.id)
    return res.body.id as string
  }

  const invOf = (id: string) => InventoryService.getInventoryByProductId(id)
  const productStockOf = async (id: string) => {
    const p = await prisma.product.findUnique({ where: { id }, select: { stock: true } })
    return Number(p?.stock ?? -1)
  }

  let pLife: string
  let pEdge: string
  let pRes: string
  let pStatus: string
  let pConc: string
  let pCod: string
  let pOnline: string
  let pAudit: string
  let pSelfHeal: string
  let pPerm: string
  let pOos: string

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    const staffLogin = await AuthService.login({
      email: 'staff@vedhicfoods.com',
      password: 'Staff@Vedhic2026',
    })
    staffToken = staffLogin.accessToken

    customerEmail = `inv.ext.customer.${ts}@vedhicfoods.com`
    const customerReg = await AuthService.register({
      fullName: 'Inventory Extended Customer',
      email: customerEmail,
      password: 'Customer@Vedhic2026!',
    })
    customerToken = customerReg.accessToken

    // Raw STAFF user with NO UserRole rows → resolves to zero permissions.
    const restrictedEmail = `inv.ext.restricted.${ts}@vedhicfoods.com`
    await prisma.user.create({
      data: {
        email: restrictedEmail,
        fullName: 'Restricted Extended Staff',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: 'STAFF',
        isActive: true,
      },
    })
    restrictedStaffToken = (
      await AuthService.login({ email: restrictedEmail, password: 'Staff@Vedhic2026!' })
    ).accessToken

    const category = await prisma.category.create({
      data: { name: `Inv Ext Cat ${ts}`, slug: `inv-ext-cat-${ts}` },
    })
    categoryId = category.id

    pLife = await createProduct('LIFE', 20)
    pEdge = await createProduct('EDGE', 10)
    pRes = await createProduct('RES', 50)
    pStatus = await createProduct('STATUS', 20)
    pConc = await createProduct('CONC', 5)
    pCod = await createProduct('COD', 10)
    pOnline = await createProduct('ONLINE', 10)
    pAudit = await createProduct('AUDIT', 30)
    pPerm = await createProduct('PERM', 8)
    pOos = await createProduct('OOS', 0)

    // Self-heal fixture: a product row with NO inventory row, created directly.
    const orphan = await prisma.product.create({
      data: {
        name: `Inventory Extended ORPHAN ${ts}`,
        slug: `inv-ext-orphan-${ts}`,
        sku: `SKU-IEXT-ORPHAN-${ts}`,
        price: 100,
        mrp: 120,
        stock: 7,
        categoryId,
      },
    })
    pSelfHeal = orphan.id
    createdProductIds.push(pSelfHeal)
  }, 60000)

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      await prisma.inventoryLog.deleteMany({ where: { productId: { in: createdProductIds } } })
      await prisma.inventory.deleteMany({ where: { productId: { in: createdProductIds } } })
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } })
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } })
  }, 60000)

  // =========================================================================
  // 1. RBAC
  // =========================================================================
  describe('RBAC & permission boundaries', () => {
    it('seeded STAFF (has inventory.read/update) can list inventory', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory')
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.items)).toBe(true)
    })

    it('seeded STAFF can adjust stock', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pPerm}/adjust`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ operation: 'ADD_STOCK', quantity: 2, reason: 'staff add' })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(10)
    })

    it('STAFF without UserRole grants is forbidden from reading inventory', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${pLife}`)
        .set('Authorization', `Bearer ${restrictedStaffToken}`)
      expect(res.status).toBe(403)
    })

    it('customer is forbidden from reading history', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${pLife}/history`)
        .set('Authorization', `Bearer ${customerToken}`)
      expect(res.status).toBe(403)
    })

    it('anonymous is unauthenticated on inventory endpoints', async () => {
      const res = await request(app).get('/api/v1/admin/inventory')
      expect(res.status).toBe(401)
    })
  })

  // =========================================================================
  // 2. LIFECYCLE & product.stock SYNC
  // =========================================================================
  describe('Stock lifecycle and Product.stock synchronisation', () => {
    it('initial inventory mirrors the product creation stock', async () => {
      const inv = await invOf(pLife)
      expect(inv.availableQuantity).toBe(20)
      expect(inv.reservedQuantity).toBe(0)
      expect(inv.soldQuantity).toBe(0)
      expect(inv.status).toBe(InventoryStatus.IN_STOCK)
      expect(await productStockOf(pLife)).toBe(20)
    })

    it('ADD_STOCK increases available and syncs product.stock', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pLife}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'ADD_STOCK', quantity: 15, reason: 'shipment' })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(35)
      expect(await productStockOf(pLife)).toBe(35)
    })

    it('REMOVE_STOCK decreases available and syncs product.stock', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pLife}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'REMOVE_STOCK', quantity: 5, reason: 'damage' })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(30)
      expect(await productStockOf(pLife)).toBe(30)
    })

    it('MANUAL_ADJUSTMENT sets an absolute target', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pLife}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'MANUAL_ADJUSTMENT', quantity: 12, reason: 'audit' })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(12)
      expect(await productStockOf(pLife)).toBe(12)
    })

    it('REMOVE_STOCK down to zero yields OUT_OF_STOCK', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pLife}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'REMOVE_STOCK', quantity: 12, reason: 'clear' })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(0)
      expect(res.body.status).toBe(InventoryStatus.OUT_OF_STOCK)
      expect(res.body.isOutOfStock).toBe(true)
    })

    it('RESTOCK increments available and decrements sold', async () => {
      // Reset pLife to a known 5 available before manufacturing sold units.
      await request(app)
        .post(`/api/v1/admin/inventory/${pLife}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'MANUAL_ADJUSTMENT', quantity: 5, reason: 'reset for restock' })

      // Manufacture 5 sold units on pLife via reserve + confirm.
      await InventoryService.reserveStock([{ productId: pLife, quantity: 5 }], {
        orderNumber: `RESTOCK-SEED-${ts}`,
      })
      await InventoryService.confirmDeduction([{ productId: pLife, quantity: 5 }], {
        orderNumber: `RESTOCK-SEED-${ts}`,
      })
      let inv = await invOf(pLife)
      expect(inv.soldQuantity).toBe(5)

      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pLife}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'RESTOCK', quantity: 5, reason: 'return to stock' })
      expect(res.status).toBe(200)
      inv = await invOf(pLife)
      expect(inv.availableQuantity).toBe(5)
      expect(inv.soldQuantity).toBe(0)
      expect(await productStockOf(pLife)).toBe(5)
    })
  })

  // =========================================================================
  // 3. STATUS COMPUTATION
  // =========================================================================
  describe('Status computation & thresholds', () => {
    it('threshold at/below available flips to LOW_STOCK', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/inventory/${pStatus}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reorderThreshold: 20, notes: 'seasonal' })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe(InventoryStatus.LOW_STOCK)
      expect(res.body.isLowStock).toBe(true)
    })

    it('explicit BACKORDER status is honoured', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/inventory/${pStatus}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'BACKORDER' })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe(InventoryStatus.BACKORDER)
    })

    it('low-stock feed includes low / out-of-stock products', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory/low-stock?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)

      const low = res.body.items.find((i: any) => i.productId === pLife)
      expect(low).toBeDefined()
      expect(low.isLowStock).toBe(true)

      const out = res.body.items.find((i: any) => i.productId === pOos)
      expect(out).toBeDefined()
      expect(out.isOutOfStock).toBe(true)
    })
  })

  // =========================================================================
  // 4. VALIDATION & GUARD RAILS
  // =========================================================================
  describe('Validation & guard rails', () => {
    it.each([
      ['zero quantity', { operation: 'ADD_STOCK', quantity: 0 }],
      ['negative quantity', { operation: 'ADD_STOCK', quantity: -5 }],
      ['fractional quantity', { operation: 'ADD_STOCK', quantity: 1.5 }],
      ['unknown operation', { operation: 'TELEPORT_STOCK', quantity: 1 }],
      ['negative threshold', { operation: 'ADD_STOCK', quantity: 1, reorderThreshold: -1 }],
    ])('rejects %s with 400', async (_label, payload) => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pEdge}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload)
      expect(res.status).toBe(400)
    })

    it('rejects removing more than available and leaves stock untouched', async () => {
      const before = (await invOf(pEdge)).availableQuantity
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pEdge}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'REMOVE_STOCK', quantity: before + 1 })
      expect(res.status).toBe(400)
      expect((await invOf(pEdge)).availableQuantity).toBe(before)
    })

    it('MANUAL_ADJUSTMENT to zero is rejected by the schema (positive-only)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pEdge}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'MANUAL_ADJUSTMENT', quantity: 0 })
      expect(res.status).toBe(400)
    })

    it('adjusting an unknown product returns 404', async () => {
      const res = await request(app)
        .post('/api/v1/admin/inventory/does-not-exist/adjust')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'ADD_STOCK', quantity: 1 })
      expect(res.status).toBe(404)
    })

    it('history for an unknown product returns 404', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory/does-not-exist/history')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(404)
    })

    it('self-heals a missing inventory row from Product.stock', async () => {
      const hasRow = await prisma.inventory.findUnique({ where: { productId: pSelfHeal } })
      expect(hasRow).toBeNull()

      const res = await request(app)
        .get(`/api/v1/admin/inventory/${pSelfHeal}`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(7)

      const nowRow = await prisma.inventory.findUnique({ where: { productId: pSelfHeal } })
      expect(nowRow).not.toBeNull()
    })
  })

  // =========================================================================
  // 5. RESERVATION LIFECYCLE SEMANTICS (service level)
  // =========================================================================
  describe('Reservation lifecycle semantics', () => {
    it('reserve moves available -> reserved and logs RESERVE_STOCK', async () => {
      const before = await invOf(pRes)
      await InventoryService.reserveStock([{ productId: pRes, quantity: 5 }], {
        orderNumber: `RES-${ts}`,
        actorEmail: 'system@test',
      })
      const after = await invOf(pRes)
      expect(after.availableQuantity).toBe(before.availableQuantity - 5)
      expect(after.reservedQuantity).toBe(before.reservedQuantity + 5)
      expect(after.soldQuantity).toBe(before.soldQuantity)
      expect(await productStockOf(pRes)).toBe(after.availableQuantity)

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: pRes, operation: 'RESERVE_STOCK' },
        orderBy: { createdAt: 'desc' },
      })
      expect(log?.quantityChange).toBe(-5)
    })

    it('rejects reserving more than available without mutating stock', async () => {
      const before = await invOf(pRes)
      await expect(
        InventoryService.reserveStock([{ productId: pRes, quantity: before.availableQuantity + 1 }])
      ).rejects.toThrow(/Insufficient stock/)
      const after = await invOf(pRes)
      expect(after.availableQuantity).toBe(before.availableQuantity)
      expect(after.reservedQuantity).toBe(before.reservedQuantity)
    })

    it('rejects non-positive reservation quantities', async () => {
      await expect(
        InventoryService.reserveStock([{ productId: pRes, quantity: 0 }])
      ).rejects.toThrow(/Invalid reservation quantity/)
      await expect(
        InventoryService.reserveStock([{ productId: pRes, quantity: -3 }])
      ).rejects.toThrow(/Invalid reservation quantity/)
    })

    it('release caps at the reserved amount and never exceeds it', async () => {
      const before = await invOf(pRes)
      // reserved contains 5 from the earlier test; attempt to release 999.
      await InventoryService.releaseReservation([{ productId: pRes, quantity: 999 }], {
        orderNumber: `REL-${ts}`,
      })
      const after = await invOf(pRes)
      expect(after.reservedQuantity).toBe(0)
      expect(after.availableQuantity).toBe(
        before.availableQuantity + before.reservedQuantity
      )
    })

    it('release with nothing reserved is a no-op', async () => {
      const before = await invOf(pRes)
      const result = await InventoryService.releaseReservation([{ productId: pRes, quantity: 10 }])
      expect(result.releasedItems).toHaveLength(0)
      const after = await invOf(pRes)
      expect(after.availableQuantity).toBe(before.availableQuantity)
      expect(after.reservedQuantity).toBe(0)
    })

    it('confirmDeduction converts reserved into sold without touching available', async () => {
      const base = await invOf(pRes)
      await InventoryService.reserveStock([{ productId: pRes, quantity: 4 }])
      await InventoryService.confirmDeduction([{ productId: pRes, quantity: 4 }], {
        orderNumber: `DED-${ts}`,
      })
      const after = await invOf(pRes)
      expect(after.availableQuantity).toBe(base.availableQuantity - 4)
      expect(after.reservedQuantity).toBe(0)
      expect(after.soldQuantity).toBe(base.soldQuantity + 4)
      expect(await productStockOf(pRes)).toBe(after.availableQuantity)
    })

    it('restockOrder returns sold units back to available', async () => {
      const base = await invOf(pRes)
      await InventoryService.restockOrder([{ productId: pRes, quantity: 2 }], {
        orderNumber: `RST-${ts}`,
      })
      const after = await invOf(pRes)
      expect(after.availableQuantity).toBe(base.availableQuantity + 2)
      expect(after.soldQuantity).toBe(Math.max(0, base.soldQuantity - 2))
    })

    it('multi-item reservation is atomic — a failing line rolls back the whole set', async () => {
      const resBefore = await invOf(pRes)
      const edgeBefore = await invOf(pEdge)

      await expect(
        InventoryService.reserveStock([
          { productId: pRes, quantity: 3 },
          { productId: pEdge, quantity: edgeBefore.availableQuantity + 100 },
        ])
      ).rejects.toThrow(/Insufficient stock/)

      const resAfter = await invOf(pRes)
      const edgeAfter = await invOf(pEdge)
      expect(resAfter.availableQuantity).toBe(resBefore.availableQuantity)
      expect(resAfter.reservedQuantity).toBe(resBefore.reservedQuantity)
      expect(edgeAfter.availableQuantity).toBe(edgeBefore.availableQuantity)
    })
  })

  // =========================================================================
  // 6. CONCURRENCY / OVERSELL PREVENTION
  // =========================================================================
  describe('Concurrency control & oversell prevention', () => {
    it('parallel service reservations never oversell a 5-unit product', async () => {
      const attempts = 8
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, (_, i) =>
          InventoryService.reserveStock([{ productId: pConc, quantity: 1 }], {
            orderNumber: `CONC-${ts}-${i}`,
          })
        )
      )
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length
      expect(fulfilled).toBe(5)

      const inv = await invOf(pConc)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.reservedQuantity).toBe(5)
      expect(inv.availableQuantity).toBeGreaterThanOrEqual(0)
      expect(await productStockOf(pConc)).toBe(0)

      // Release everything back and prove the counter returns exactly.
      await InventoryService.releaseReservation([{ productId: pConc, quantity: 5 }])
      const released = await invOf(pConc)
      expect(released.availableQuantity).toBe(5)
      expect(released.reservedQuantity).toBe(0)
    })

    it('parallel COD checkouts never oversell a 4-unit product', async () => {
      // Reset the product to exactly 4 available.
      await request(app)
        .post(`/api/v1/admin/inventory/${pConc}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'MANUAL_ADJUSTMENT', quantity: 4 })

      const buyers = 6
      const responses = await Promise.all(
        Array.from({ length: buyers }, (_, i) =>
          request(app)
            .post('/api/v1/orders/checkout')
            .send({
              customerName: `Conc Buyer ${i}`,
              customerEmail: `inv.ext.conc.${ts}.${i}@example.com`,
              phone: guestPhone(i),
              addressLine: `${i} Race Road`,
              city: 'Pune',
              state: 'Maharashtra',
              pincode: '411001',
              paymentMethod: 'COD',
              items: [{ productId: pConc, quantity: 1 }],
            })
        )
      )

      const created = responses.filter((r) => r.status === 201).length
      const failures = responses.filter((r) => r.status >= 400 && r.status < 500).length
      expect(created).toBe(4)
      expect(created + failures).toBe(buyers)

      const inv = await invOf(pConc)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.reservedQuantity).toBe(0)
      expect(inv.soldQuantity).toBe(4)
      expect(inv.availableQuantity).toBeGreaterThanOrEqual(0)
      expect(await productStockOf(pConc)).toBe(0)
    }, 60000)
  })

  // =========================================================================
  // 7. CHECKOUT INTEGRATION
  // =========================================================================
  describe('Checkout integration', () => {
    it('COD checkout reserves and immediately deducts (sold)', async () => {
      const res = await request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Extended COD',
          customerEmail: `inv.ext.cod.${ts}@example.com`,
          phone: guestPhone(6),
          addressLine: '6 Cod Lane',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          paymentMethod: 'COD',
          items: [{ productId: pCod, quantity: 3 }],
        })
      expect(res.status).toBe(201)
      expect(res.body.status).toBe('CONFIRMED')

      const inv = await invOf(pCod)
      expect(inv.availableQuantity).toBe(7)
      expect(inv.reservedQuantity).toBe(0)
      expect(inv.soldQuantity).toBe(3)
    })

    it('online (RAZORPAY) checkout reserves only — no sold movement', async () => {
      const res = await request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          customerName: 'Inventory Extended Customer',
          customerEmail,
          phone: guestPhone(7),
          addressLine: '7 Online Lane',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          paymentMethod: 'RAZORPAY',
          items: [{ productId: pOnline, quantity: 3 }],
        })
      expect(res.status).toBe(201)
      expect(res.body.status).toBe('PENDING_PAYMENT')

      const inv = await invOf(pOnline)
      expect(inv.availableQuantity).toBe(7)
      expect(inv.reservedQuantity).toBe(3)
      expect(inv.soldQuantity).toBe(0)
      expect(await productStockOf(pOnline)).toBe(7)
    })

    it('cancelling an online PENDING_PAYMENT order RELEASES the reservation', async () => {
      // Fresh order so the assertion is independent of the previous test's order.
      const createRes = await request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          customerName: 'Inventory Extended Customer',
          customerEmail,
          phone: guestPhone(8),
          addressLine: '8 Release Lane',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          paymentMethod: 'RAZORPAY',
          items: [{ productId: pOnline, quantity: 2 }],
        })
      expect(createRes.status).toBe(201)
      const orderId = createRes.body.orderId

      const before = await invOf(pOnline)
      expect(before.reservedQuantity).toBeGreaterThanOrEqual(2)

      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'changed mind before paying' })
      expect(cancelRes.status).toBe(200)

      const after = await invOf(pOnline)
      // The 2 units must return to available and the reservation pool must drop.
      expect(after.availableQuantity).toBe(before.availableQuantity + 2)
      expect(after.reservedQuantity).toBe(before.reservedQuantity - 2)
      // soldQuantity must be untouched — nothing was ever sold on this order.
      expect(after.soldQuantity).toBe(before.soldQuantity)
    })

    it('cancelling an already payment-failed order does not double-restore stock', async () => {
      const createRes = await request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          customerName: 'Inventory Extended Customer',
          customerEmail,
          phone: guestPhone(9),
          addressLine: '9 Failed Lane',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          paymentMethod: 'RAZORPAY',
          items: [{ productId: pOnline, quantity: 1 }],
        })
      expect(createRes.status).toBe(201)
      const orderId = createRes.body.orderId

      const frozen = await invOf(pOnline)

      const failRes = await request(app)
        .post(`/api/v1/orders/${orderId}/fail-payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'card declined' })
      expect([200, 201]).toContain(failRes.status)

      const afterFail = await invOf(pOnline)
      expect(afterFail.availableQuantity).toBe(frozen.availableQuantity + 1)
      expect(afterFail.reservedQuantity).toBe(frozen.reservedQuantity - 1)

      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'cleanup' })
      expect(cancelRes.status).toBe(200)

      const afterCancel = await invOf(pOnline)
      // A failed order was already released; cancelling must be inert on stock.
      expect(afterCancel.availableQuantity).toBe(afterFail.availableQuantity)
      expect(afterCancel.reservedQuantity).toBe(afterFail.reservedQuantity)
      expect(afterCancel.soldQuantity).toBe(afterFail.soldQuantity)
    })

    it('cancelling a confirmed COD order restocks available and decrements sold', async () => {
      const createRes = await request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Extended Cancel COD',
          customerEmail: `inv.ext.cancelcod.${ts}@example.com`,
          phone: guestPhone(10),
          addressLine: '10 Cancel Lane',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          paymentMethod: 'COD',
          items: [{ productId: pCod, quantity: 2 }],
        })
      expect(createRes.status).toBe(201)
      const orderId = createRes.body.orderId

      const before = await invOf(pCod)
      expect(before.soldQuantity).toBeGreaterThanOrEqual(2)

      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'customer request' })
      expect(cancelRes.status).toBe(200)

      const after = await invOf(pCod)
      expect(after.availableQuantity).toBe(before.availableQuantity + 2)
      expect(after.soldQuantity).toBe(before.soldQuantity - 2)
      expect(await productStockOf(pCod)).toBe(after.availableQuantity)
    })
  })

  // =========================================================================
  // 8. AUDIT TRAIL / HISTORY
  // =========================================================================
  describe('Audit trail integrity', () => {
    it('every manual stock change writes exactly one InventoryLog row', async () => {
      const countBefore = await prisma.inventoryLog.count({ where: { productId: pAudit } })

      await request(app)
        .post(`/api/v1/admin/inventory/${pAudit}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'ADD_STOCK', quantity: 5, reason: 'audit add' })

      await request(app)
        .post(`/api/v1/admin/inventory/${pAudit}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'REMOVE_STOCK', quantity: 2, reason: 'audit remove' })

      const countAfter = await prisma.inventoryLog.count({ where: { productId: pAudit } })
      expect(countAfter).toBe(countBefore + 2)
    })

    it('records precise before/after quantities and actor identity', async () => {
      const baseline = await invOf(pAudit)
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${pAudit}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ operation: 'ADD_STOCK', quantity: 7, reason: 'traceability' })
      expect(res.status).toBe(200)

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: pAudit, operation: 'ADD_STOCK', reason: 'traceability' },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
      expect(log!.previousQuantity).toBe(baseline.availableQuantity)
      expect(log!.newQuantity).toBe(baseline.availableQuantity + 7)
      expect(log!.quantityChange).toBe(7)
      expect(log!.actorId).not.toBeNull()
      expect(log!.actorEmail).toBe('admin@vedhicfoods.com')
    })

    it('threshold PATCH is itself audited as a manual adjustment', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/inventory/${pAudit}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reorderThreshold: 40, notes: 'raise threshold' })
      expect(res.status).toBe(200)

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: pAudit, reason: 'raise threshold' },
        orderBy: { createdAt: 'desc' },
      })
      expect(log).not.toBeNull()
      expect(log!.operation).toBe('MANUAL_ADJUSTMENT')
      expect(log!.quantityChange).toBe(0)
      expect((log!.metadata as any).newThreshold).toBe(40)
    })

    it('history endpoint returns paginated log entries newest-first', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${pAudit}/history?limit=3`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBeLessThanOrEqual(3)
      expect(res.body.total).toBeGreaterThanOrEqual(4)
      if (res.body.items.length >= 2) {
        const [a, b] = res.body.items
        expect(new Date(a.createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(b.createdAt).getTime()
        )
      }
    })

    it('reserve / release / deduct / restock each emit their own log operation', async () => {
      const probe = await createProduct('AUDITP', 20)
      const ctx = { orderNumber: `AUDIT-${ts}` }

      await InventoryService.reserveStock([{ productId: probe, quantity: 3 }], ctx)
      await InventoryService.confirmDeduction([{ productId: probe, quantity: 3 }], ctx)
      await InventoryService.restockOrder([{ productId: probe, quantity: 3 }], ctx)
      await InventoryService.reserveStock([{ productId: probe, quantity: 2 }], ctx)
      await InventoryService.releaseReservation([{ productId: probe, quantity: 2 }], ctx)

      const operations = (
        await prisma.inventoryLog.findMany({
          where: { productId: probe },
          select: { operation: true },
        })
      ).map((l) => l.operation)

      expect(operations).toContain('RESERVE_STOCK')
      expect(operations).toContain('CONFIRM_DEDUCTION')
      expect(operations).toContain('RESTOCK')
      expect(operations).toContain('RELEASE_RESERVATION')
    })
  })
})
