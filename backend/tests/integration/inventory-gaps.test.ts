import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InventoryService } from '../../src/services/inventory.service'
import { InventoryStatus } from '@prisma/client'
import { INVENTORY_AUDIT_ACTIONS } from '../../src/types/inventory.types'

const app = createApp()
const ts = Date.now()
const phoneFor = (n: number) => `9${String((ts + n) % 1000000000).padStart(9, '0')}`

/**
 * Gap coverage for the inventory domain: admin stock mutations and their DB
 * reflection, status/threshold behaviour, history + audit trail, negative
 * guards (API and PostgreSQL CHECK backstop), idempotency, concurrency and the
 * admin-vs-storefront stock consistency requirement.
 */
describe('Inventory — admin operations, DB backstop, audit, idempotency & concurrency', () => {
  let adminToken = ''
  let adminId = ''
  let customerToken = ''
  let restrictedStaffToken = ''
  let categoryId = ''

  const productIds: string[] = []
  const inventoryIds: string[] = []
  const userIds: string[] = []
  const orderIds: string[] = []

  const createProduct = async (
    label: string,
    stock: number,
    extra: Record<string, unknown> = {}
  ) => {
    const product = await prisma.product.create({
      data: {
        name: `Inventory Gap ${label} ${ts}`,
        slug: `inv-gap-${label}-${ts}`.toLowerCase(),
        sku: `SKU-IGAP-${label}-${ts}`,
        price: 100,
        mrp: 120,
        unit: 'piece',
        stock,
        categoryId,
        isActive: true,
        status: 'PUBLISHED',
        isDeleted: false,
        ...extra,
        inventory: {
          create: {
            availableQuantity: stock,
            reservedQuantity: 0,
            soldQuantity: 0,
            reorderThreshold: 10,
            status:
              stock > 10
                ? InventoryStatus.IN_STOCK
                : stock > 0
                  ? InventoryStatus.LOW_STOCK
                  : InventoryStatus.OUT_OF_STOCK,
          },
        },
      },
      include: { inventory: true },
    })
    productIds.push(product.id)
    if (product.inventory) inventoryIds.push(product.inventory.id)
    return product
  }

  const invOf = (productId: string) => InventoryService.getInventoryByProductId(productId)
  const dbInv = (productId: string) =>
    prisma.inventory.findUniqueOrThrow({ where: { productId } })
  const dbProduct = (productId: string) =>
    prisma.product.findUniqueOrThrow({ where: { id: productId } })

  const adjust = (productId: string, body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  const expectConstraintRejection = async (op: () => Promise<unknown>) => {
    let error: any
    try {
      await op()
    } catch (err) {
      error = err
    }
    expect(error, 'expected the database CHECK constraint to reject the write').toBeDefined()
    const surface = `${error?.code ?? ''} ${error?.message ?? ''}`
    expect(surface).toMatch(/23514|violates check constraint|P2004/)
  }

  let pAdmin = ''
  let pThreshold = ''
  let pOos = ''
  let pNeg = ''
  let pConc = ''
  let pIdem = ''
  let pBundle = ''
  let pAdj = ''

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id

    const customer = await AuthService.register({
      fullName: 'Inventory Gap Customer',
      email: `inv.gap.customer.${ts}@vedhicfoods.com`,
      phone: phoneFor(1),
      password: 'Customer@Vedhic2026!',
    })
    customerToken = customer.accessToken
    userIds.push(customer.user.id)

    const restrictedEmail = `inv.gap.staff.${ts}@vedhicfoods.com`
    const restricted = await prisma.user.create({
      data: {
        email: restrictedEmail,
        fullName: 'Inventory Gap Restricted Staff',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        phone: phoneFor(2),
        role: 'STAFF',
        isActive: true,
      },
    })
    userIds.push(restricted.id)
    restrictedStaffToken = (
      await AuthService.login({ email: restrictedEmail, password: 'Staff@Vedhic2026!' })
    ).accessToken

    const category = await prisma.category.create({
      data: { name: `Inventory Gap ${ts}`, slug: `inventory-gap-${ts}` },
    })
    categoryId = category.id

    pAdmin = (await createProduct('ADMIN', 50)).id
    pThreshold = (await createProduct('THRESHOLD', 20)).id
    pOos = (await createProduct('OOS', 0)).id
    pNeg = (await createProduct('NEG', 5)).id
    pConc = (await createProduct('CONC', 6)).id
    pIdem = (await createProduct('IDEM', 10)).id
    pBundle = (await createProduct('BUNDLE', 30)).id
    pAdj = (await createProduct('ADJ', 20)).id
  }, 60000)

  afterAll(async () => {
    if (inventoryIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entity: 'Inventory', entityId: { in: inventoryIds } },
      })
    }
    if (productIds.length > 0) {
      await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } })
      await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } })
      await prisma.product.deleteMany({ where: { id: { in: productIds } } })
    }
    if (orderIds.length > 0) {
      await prisma.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } })
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    }
    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } })
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } })
    }
  }, 60000)

  // =========================================================================
  // 1. ADMIN OPERATIONS MOVE THE DB QUANTITY
  // =========================================================================
  describe('Admin stock operations reflect in the database', () => {
    it('ADD_STOCK increases available and product.stock, and logs the movement', async () => {
      const res = await adjust(pAdmin, {
        operation: 'ADD_STOCK',
        quantity: 15,
        reason: 'gap-add',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(65)

      const inv = await dbInv(pAdmin)
      expect(inv.availableQuantity).toBe(65)
      expect(inv.reservedQuantity).toBe(0)
      expect((await dbProduct(pAdmin)).stock).toBe(65)

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: pAdmin, reason: 'gap-add' },
      })
      expect(log).toMatchObject({
        operation: 'ADD_STOCK',
        previousQuantity: 50,
        newQuantity: 65,
        quantityChange: 15,
        actorId: adminId,
        actorEmail: 'admin@vedhicfoods.com',
      })
    })

    it('REMOVE_STOCK decreases available and product.stock', async () => {
      const res = await adjust(pAdmin, {
        operation: 'REMOVE_STOCK',
        quantity: 5,
        reason: 'gap-remove',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(60)
      expect((await dbInv(pAdmin)).availableQuantity).toBe(60)
      expect((await dbProduct(pAdmin)).stock).toBe(60)
    })

    it('MANUAL_ADJUSTMENT sets an absolute target quantity', async () => {
      const res = await adjust(pAdmin, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 42,
        reason: 'gap-manual',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(42)
      expect((await dbInv(pAdmin)).availableQuantity).toBe(42)
      expect((await dbProduct(pAdmin)).stock).toBe(42)

      const log = await prisma.inventoryLog.findFirst({
        where: { productId: pAdmin, reason: 'gap-manual' },
      })
      expect(log).toMatchObject({
        operation: 'MANUAL_ADJUSTMENT',
        previousQuantity: 60,
        newQuantity: 42,
        quantityChange: -18,
      })
    })

    it('RESTOCK credits available back and reduces sold', async () => {
      await InventoryService.reserveStock([{ productId: pIdem, quantity: 4 }], {
        orderNumber: `GAP-RESTOCK-${ts}`,
      })
      await InventoryService.confirmDeduction([{ productId: pIdem, quantity: 4 }], {
        orderNumber: `GAP-RESTOCK-${ts}`,
      })
      const before = await dbInv(pIdem)
      expect(before.soldQuantity).toBe(4)
      expect(before.availableQuantity).toBe(6)

      const res = await adjust(pIdem, {
        operation: 'RESTOCK',
        quantity: 4,
        reason: 'gap-restock',
      })
      expect(res.status).toBe(200)
      const after = await dbInv(pIdem)
      expect(after.availableQuantity).toBe(10)
      expect(after.soldQuantity).toBe(0)
      expect((await dbProduct(pIdem)).stock).toBe(10)
    })
  })

  // =========================================================================
  // 2. THRESHOLD / LOW STOCK / OUT OF STOCK
  // =========================================================================
  describe('Reorder threshold, low stock and out-of-stock storefront state', () => {
    it('raising the threshold above available flips status to LOW_STOCK', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/inventory/${pThreshold}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reorderThreshold: 25, notes: 'gap-threshold' })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe(InventoryStatus.LOW_STOCK)
      expect(res.body.isLowStock).toBe(true)
      expect((await dbInv(pThreshold)).reorderThreshold).toBe(25)
    })

    it('draining to zero yields OUT_OF_STOCK in DB, admin view and storefront', async () => {
      const res = await adjust(pThreshold, {
        operation: 'REMOVE_STOCK',
        quantity: 20,
        reason: 'gap-drain',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(0)
      expect(res.body.status).toBe(InventoryStatus.OUT_OF_STOCK)
      expect(res.body.isOutOfStock).toBe(true)

      const inv = await dbInv(pThreshold)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.status).toBe(InventoryStatus.OUT_OF_STOCK)
      expect((await dbProduct(pThreshold)).stock).toBe(0)

      const publicRes = await request(app).get(`/api/v1/products/${pThreshold}`)
      expect(publicRes.status).toBe(200)
      expect(publicRes.body.stock).toBe(0)
      expect(publicRes.body.availability).toBe('OUT_OF_STOCK')
      expect(publicRes.body.isAvailable).toBe(false)
    })

    it('a product created with stock 0 is out of stock everywhere', async () => {
      const inv = await dbInv(pOos)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.status).toBe(InventoryStatus.OUT_OF_STOCK)

      const publicRes = await request(app).get(`/api/v1/products/${pOos}`)
      expect(publicRes.status).toBe(200)
      expect(publicRes.body.stock).toBe(0)
      expect(publicRes.body.availability).toBe('OUT_OF_STOCK')
      expect(publicRes.body.isAvailable).toBe(false)
    })

    it('the low-stock feed reports the out-of-stock product', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory/low-stock?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      const found = res.body.items.find((i: any) => i.productId === pThreshold)
      expect(found).toBeDefined()
      expect(found.isOutOfStock).toBe(true)
    })
  })

  // =========================================================================
  // 3. HISTORY + AUDIT TRAIL
  // =========================================================================
  describe('History and audit trail', () => {
    it('history returns log rows with actor, operation, reason and before/after', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${pAdmin}/history?limit=50`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.items.length).toBeGreaterThanOrEqual(3)
      expect(res.body.total).toBeGreaterThanOrEqual(3)

      const manual = res.body.items.find((l: any) => l.reason === 'gap-manual')
      expect(manual).toBeDefined()
      expect(manual.operation).toBe('MANUAL_ADJUSTMENT')
      expect(manual.previousQuantity).toBe(60)
      expect(manual.newQuantity).toBe(42)
      expect(manual.actorEmail).toBe('admin@vedhicfoods.com')

      const timestamps = res.body.items.map((l: any) => new Date(l.createdAt).getTime())
      const sorted = [...timestamps].sort((a, b) => b - a)
      expect(timestamps).toEqual(sorted)
    })

    it('every successful adjustment writes an AuditLog record for the inventory entity', async () => {
      const res = await adjust(pAdmin, {
        operation: 'ADD_STOCK',
        quantity: 3,
        reason: 'gap-audit-row',
      })
      expect(res.status).toBe(200)

      const inv = await dbInv(pAdmin)
      const audit = await prisma.auditLog.findFirst({
        where: {
          entity: 'Inventory',
          entityId: inv.id,
          action: INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED,
        },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect(audit!.actorId).toBe(adminId)
      expect((audit!.metadata as any).productId).toBe(pAdmin)
      expect((audit!.metadata as any).operation).toBe('ADD_STOCK')
      expect((audit!.metadata as any).reason).toBe('gap-audit-row')
    })

    it('RESTOCK is audited under the STOCK_RESTOCKED action', async () => {
      const res = await adjust(pIdem, {
        operation: 'RESTOCK',
        quantity: 1,
        reason: 'gap-restock-audit',
      })
      expect(res.status).toBe(200)
      const inv = await dbInv(pIdem)
      const audit = await prisma.auditLog.findFirst({
        where: { entityId: inv.id, action: INVENTORY_AUDIT_ACTIONS.STOCK_RESTOCKED },
      })
      expect(audit).not.toBeNull()
    })

    it('the audit metadata carries an accurate absolute previous quantity for MANUAL_ADJUSTMENT', async () => {
      const before = (await dbInv(pAdmin)).availableQuantity
      const res = await adjust(pAdmin, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 11,
        reason: 'gap-audit-previous',
      })
      expect(res.status).toBe(200)

      const inv = await dbInv(pAdmin)
      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'Inventory', entityId: inv.id, action: INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED },
        orderBy: { createdAt: 'desc' },
      })
      expect((audit!.metadata as any).reason).toBe('gap-audit-previous')
      expect((audit!.metadata as any).previousQuantity).toBe(before)
      expect((audit!.metadata as any).newQuantity).toBe(11)
    })
  })

  // =========================================================================
  // 4. NEGATIVE / GUARD RAILS
  // =========================================================================
  describe('Negative cases and guard rails', () => {
    it.each([
      ['zero quantity', { operation: 'ADD_STOCK', quantity: 0 }],
      ['negative quantity', { operation: 'ADD_STOCK', quantity: -5 }],
      ['fractional quantity', { operation: 'ADD_STOCK', quantity: 1.5 }],
      ['non-numeric quantity', { operation: 'ADD_STOCK', quantity: 'abc' }],
      ['unknown operation', { operation: 'PHASE_SHIFT', quantity: 1 }],
      ['negative threshold', { operation: 'ADD_STOCK', quantity: 1, reorderThreshold: -1 }],
    ])('API rejects %s with 400', async (_label, payload) => {
      const res = await adjust(pNeg, payload)
      expect(res.status).toBe(400)
    })

    it('API rejects removing more than available and leaves the row untouched', async () => {
      const before = await dbInv(pNeg)
      const res = await adjust(pNeg, {
        operation: 'REMOVE_STOCK',
        quantity: before.availableQuantity + 1,
      })
      expect(res.status).toBe(400)
      const after = await dbInv(pNeg)
      expect(after.availableQuantity).toBe(before.availableQuantity)
    })

    it('the DB CHECK constraint blocks negative inventory and product stock writes', async () => {
      await expectConstraintRejection(() =>
        prisma.inventory.update({ where: { productId: pNeg }, data: { availableQuantity: -1 } })
      )
      await expectConstraintRejection(() =>
        prisma.inventory.update({ where: { productId: pNeg }, data: { reservedQuantity: -1 } })
      )
      await expectConstraintRejection(() =>
        prisma.inventory.update({ where: { productId: pNeg }, data: { soldQuantity: -1 } })
      )
      await expectConstraintRejection(() =>
        prisma.inventory.update({ where: { productId: pNeg }, data: { reorderThreshold: -1 } })
      )
      await expectConstraintRejection(() =>
        prisma.product.update({ where: { id: pNeg }, data: { stock: -1 } })
      )

      const inv = await dbInv(pNeg)
      expect(inv.availableQuantity).toBeGreaterThanOrEqual(0)
    })

    it('rejects anonymous, customer and permission-less staff writes', async () => {
      const anon = await request(app)
        .post(`/api/v1/admin/inventory/${pNeg}/adjust`)
        .send({ operation: 'ADD_STOCK', quantity: 1 })
      expect(anon.status).toBe(401)

      const customer = await adjust(pNeg, { operation: 'ADD_STOCK', quantity: 1 }, customerToken)
      expect(customer.status).toBe(403)

      const restricted = await adjust(
        pNeg,
        { operation: 'ADD_STOCK', quantity: 1 },
        restrictedStaffToken
      )
      expect(restricted.status).toBe(403)

      expect((await dbInv(pNeg)).availableQuantity).toBe(5)
    })

    it('restockOrder is idempotent per order reference and does not double-apply', async () => {
      const orderId = `gap-idem-order-${ts}`
      // `inventory_logs.orderId` is a real FK to orders, so the ledger entry
      // needs a persisted order to reference (the FK is enforced by
      // inventory_logs_order_id_fkey).
      await prisma.order.create({
        data: {
          id: orderId,
          orderNumber: `GAP-IDEM-${ts}`,
          userId: adminId,
          customerName: 'Inventory Gap Idempotency',
          customerEmail: 'inv-gap-idem@vedhicfoods.com',
          phone: phoneFor(999),
          subtotal: 300,
          total: 300,
          paymentMethod: 'COD',
        },
      })
      orderIds.push(orderId)
      await InventoryService.reserveStock([{ productId: pIdem, quantity: 3 }], { orderId })
      await InventoryService.confirmDeduction([{ productId: pIdem, quantity: 3 }], { orderId })

      const before = await dbInv(pIdem)
      await InventoryService.restockOrder([{ productId: pIdem, quantity: 3 }], { orderId })
      const afterFirst = await dbInv(pIdem)
      expect(afterFirst.availableQuantity).toBe(before.availableQuantity + 3)

      const replay = await InventoryService.restockOrder([{ productId: pIdem, quantity: 3 }], {
        orderId,
      })
      expect(replay.restockedItems).toHaveLength(0)

      const afterSecond = await dbInv(pIdem)
      expect(afterSecond.availableQuantity).toBe(afterFirst.availableQuantity)
      expect(afterSecond.soldQuantity).toBe(afterFirst.soldQuantity)

      const restockLogs = await prisma.inventoryLog.count({
        where: { productId: pIdem, orderId, operation: 'RESTOCK' },
      })
      expect(restockLogs).toBe(1)
    })
  })

  // =========================================================================
  // 5. EACH ADJUSTMENT BUNDLE
  // =========================================================================
  describe('A single adjustment updates row, product, history and audit together', () => {
    it('ADD_STOCK touches all four surfaces', async () => {
      const logBefore = await prisma.inventoryLog.count({ where: { productId: pBundle } })
      const res = await adjust(pBundle, {
        operation: 'ADD_STOCK',
        quantity: 7,
        reason: 'gap-bundle',
      })
      expect(res.status).toBe(200)

      const inv = await dbInv(pBundle)
      expect(inv.availableQuantity).toBe(37)
      expect((await dbProduct(pBundle)).stock).toBe(37)

      const logAfter = await prisma.inventoryLog.count({ where: { productId: pBundle } })
      expect(logAfter).toBe(logBefore + 1)

      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'Inventory', entityId: inv.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(audit).not.toBeNull()
    })
  })

  // =========================================================================
  // 6. CONCURRENCY
  // =========================================================================
  describe('Concurrency: no oversell and no lost updates', () => {
    it('parallel reservations never oversell the 6 available units', async () => {
      const attempts = 12
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, (_, i) =>
          InventoryService.reserveStock([{ productId: pConc, quantity: 1 }], {
            orderNumber: `GAP-CONC-${ts}-${i}`,
          })
        )
      )
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length
      expect(fulfilled).toBe(6)

      const inv = await dbInv(pConc)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.reservedQuantity).toBe(6)
      expect(inv.availableQuantity).toBeGreaterThanOrEqual(0)
      expect((await dbProduct(pConc)).stock).toBe(0)

      await InventoryService.releaseReservation([{ productId: pConc, quantity: 6 }])
      const released = await dbInv(pConc)
      expect(released.availableQuantity).toBe(6)
      expect(released.reservedQuantity).toBe(0)
    }, 60000)

    it('parallel admin adjustments do not lose increments', async () => {
      const adds = await Promise.all(
        Array.from({ length: 10 }, () =>
          adjust(pAdj, { operation: 'ADD_STOCK', quantity: 5, reason: 'gap-concurrent-add' })
        )
      )
      expect(adds.every((r) => r.status === 200)).toBe(true)

      const afterAdds = await dbInv(pAdj)
      expect(afterAdds.availableQuantity).toBe(70)
      expect((await dbProduct(pAdj)).stock).toBe(70)

      const removes = await Promise.all(
        Array.from({ length: 10 }, () =>
          adjust(pAdj, { operation: 'REMOVE_STOCK', quantity: 2, reason: 'gap-concurrent-remove' })
        )
      )
      expect(removes.every((r) => r.status === 200)).toBe(true)

      const afterRemoves = await dbInv(pAdj)
      expect(afterRemoves.availableQuantity).toBe(50)
      expect(afterRemoves.availableQuantity).toBeGreaterThanOrEqual(0)
      expect((await dbProduct(pAdj)).stock).toBe(50)
    }, 60000)
  })

  // =========================================================================
  // 7 & 8. ADMIN vs STOREFRONT CONSISTENCY + IMMEDIATE REFLECTION
  // =========================================================================
  describe('Admin and storefront stock consistency', () => {
    it('admin inventory and the public product endpoint agree after an adjustment', async () => {
      const res = await adjust(pAdmin, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 37,
        reason: 'gap-consistency',
      })
      expect(res.status).toBe(200)

      const adminView = await invOf(pAdmin)
      const publicView = await request(app).get(`/api/v1/products/${pAdmin}`)

      expect(adminView.availableQuantity).toBe(37)
      expect(publicView.status).toBe(200)
      expect(publicView.body.stock).toBe(37)
      expect((await dbProduct(pAdmin)).stock).toBe(37)
    })

    it('an admin change is reflected on the very next public GET', async () => {
      const res = await adjust(pAdmin, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 23,
        reason: 'gap-immediate',
      })
      expect(res.status).toBe(200)

      const publicView = await request(app).get(`/api/v1/products/${pAdmin}`)
      expect(publicView.status).toBe(200)
      expect(publicView.body.stock).toBe(23)
      expect(publicView.body.availability).toBe('IN_STOCK')
      expect(publicView.body.isAvailable).toBe(true)
    })
  })
})
