import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InventoryService } from '../../src/services/inventory.service'
import { InventoryStatus, ProductStatus } from '@prisma/client'
import { INVENTORY_AUDIT_ACTIONS } from '../../src/types/inventory.types'
import {
  ensureDemoCustomer,
  DEMO_CUSTOMER_EMAIL,
  DEMO_CUSTOMER_PASSWORD,
} from './helpers/demo-user'

const app = createApp()
const ts = Date.now()

// `User.phone` is unique and this database is shared across suites without
// truncation, so every fixture phone is derived from the run timestamp.
const phoneFor = (n: number) => `9${String((ts + n) % 1000000000).padStart(9, '0')}`

/**
 * Comprehensive admin inventory operations coverage.
 *
 * Every stock mutation is asserted against four surfaces at once:
 *   (a) the persisted `inventories` row AND the denormalised `Product.stock`,
 *   (b) the public product detail + listing availability label,
 *   (c) the append-only `inventory_logs` history row,
 *   (d) the `audit_logs` administrative trail (where the operation records one).
 *
 * It also covers threshold/out-of-stock transitions in both directions, guard
 * rails (negative / zero / non-numeric / fractional / overflowing quantities and
 * insufficient-stock removals), RBAC (anon 401, customer & restricted staff
 * 403), idempotency (manual adjustment re-application and restockOrder per
 * order) and concurrency (reservation oversell prevention and lost-update
 * detection for parallel admin adjustments).
 */
describe('Inventory — admin operations, availability, history, audit, idempotency & concurrency', () => {
  let adminToken = ''
  let adminId = ''
  let adminEmail = ''
  let staffToken = ''
  let customerToken = ''
  let restrictedStaffToken = ''

  let categoryId = ''

  const productIds: string[] = []
  const inventoryIds: string[] = []
  const orderIds: string[] = []
  const fixtureUserIds: string[] = []

  const createProduct = async (
    label: string,
    stock: number,
    extra: Record<string, unknown> = {}
  ) => {
    const product = await prisma.product.create({
      data: {
        name: `Inventory AdminOps ${label} ${ts}`,
        slug: `inv-adminops-${label}-${ts}`.toLowerCase(),
        sku: `SKU-IAO-${label}-${ts}`,
        price: 100,
        mrp: 120,
        unit: 'piece',
        stock,
        categoryId,
        isActive: true,
        status: ProductStatus.PUBLISHED,
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

  const dbInv = (productId: string) =>
    prisma.inventory.findUniqueOrThrow({ where: { productId } })
  const dbProduct = (productId: string) =>
    prisma.product.findUniqueOrThrow({ where: { id: productId } })

  const adjust = (productId: string, body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  const patch = (productId: string, body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .patch(`/api/v1/admin/inventory/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)

  const publicView = async (productId: string) => {
    const res = await request(app).get(`/api/v1/products/${productId}`)
    expect(res.status).toBe(200)
    return res.body as { stock: number; availability: string; isAvailable: boolean }
  }

  const latestLog = (productId: string, reason: string) =>
    prisma.inventoryLog.findFirst({
      where: { productId, reason },
      orderBy: { createdAt: 'desc' },
    })

  const latestAudit = (inventoryId: string, action: string) =>
    prisma.auditLog.findFirst({
      where: { entity: 'Inventory', entityId: inventoryId, action },
      orderBy: { createdAt: 'desc' },
    })

  let pLife = ''
  let pLifeSku = ''
  let pRestock = ''
  let pThreshold = ''
  let pOos = ''
  let pNeg = ''
  let pIdem = ''
  let pConc = ''
  let pConc2 = ''
  let pStaff = ''

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken
    adminId = adminLogin.user.id
    adminEmail = adminLogin.user.email

    const staffLogin = await AuthService.login({
      email: 'staff@vedhicfoods.com',
      password: 'Staff@Vedhic2026',
    })
    staffToken = staffLogin.accessToken

    await ensureDemoCustomer()
    customerToken = (
      await AuthService.login({ email: DEMO_CUSTOMER_EMAIL, password: DEMO_CUSTOMER_PASSWORD })
    ).accessToken

    // Raw STAFF user with NO UserRole grants → resolves to zero permissions.
    const restrictedEmail = `inv.adminops.restricted.${ts}@vedhicfoods.com`
    const restricted = await prisma.user.create({
      data: {
        email: restrictedEmail,
        fullName: 'Inventory AdminOps Restricted Staff',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        phone: phoneFor(1),
        role: 'STAFF',
        isActive: true,
      },
    })
    fixtureUserIds.push(restricted.id)
    restrictedStaffToken = (
      await AuthService.login({ email: restrictedEmail, password: 'Staff@Vedhic2026!' })
    ).accessToken

    const category = await prisma.category.create({
      data: { name: `Inventory AdminOps ${ts}`, slug: `inventory-adminops-${ts}` },
    })
    categoryId = category.id

    const life = await createProduct('LIFE', 25)
    pLife = life.id
    pLifeSku = life.sku
    pRestock = (await createProduct('RESTOCK', 10)).id
    pThreshold = (await createProduct('THRESHOLD', 20)).id
    pOos = (await createProduct('OOS', 0)).id
    pNeg = (await createProduct('NEG', 5)).id
    pIdem = (await createProduct('IDEM', 10)).id
    pConc = (await createProduct('CONC', 6)).id
    pConc2 = (await createProduct('CONC2', 100)).id
    pStaff = (await createProduct('STAFF', 8)).id
  }, 60000)

  afterAll(async () => {
    if (inventoryIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entity: 'Inventory', entityId: { in: inventoryIds } },
      })
    }
    if (fixtureUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: fixtureUserIds } } })
    }
    if (productIds.length > 0) {
      await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } })
    }
    if (orderIds.length > 0) {
      await prisma.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } })
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    }
    if (productIds.length > 0) {
      await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } })
      await prisma.product.deleteMany({ where: { id: { in: productIds } } })
    }
    if (fixtureUserIds.length > 0) {
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } })
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } })
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } })
    }
  }, 60000)

  // =========================================================================
  // 1. STOCK INCREASE / DECREASE / ADJUSTMENT — FOUR SURFACES EACH
  // =========================================================================
  describe('Stock lifecycle: DB row, product stock, availability, history and audit', () => {
    it('starts from the product creation baseline', async () => {
      const inv = await dbInv(pLife)
      expect(inv.availableQuantity).toBe(25)
      expect(inv.reservedQuantity).toBe(0)
      expect(inv.soldQuantity).toBe(0)
      expect(inv.reorderThreshold).toBe(10)
      expect(inv.status).toBe(InventoryStatus.IN_STOCK)
      expect((await dbProduct(pLife)).stock).toBe(25)
    })

    it('ADD_STOCK updates inventory + Product.stock, availability, history and audit', async () => {
      const res = await adjust(pLife, {
        operation: 'ADD_STOCK',
        quantity: 15,
        reason: 'adminops-add',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(40)

      const inv = await dbInv(pLife)
      expect(inv.availableQuantity).toBe(40)
      expect(inv.reservedQuantity).toBe(0)
      expect(inv.status).toBe(InventoryStatus.IN_STOCK)
      expect((await dbProduct(pLife)).stock).toBe(40)

      const pub = await publicView(pLife)
      expect(pub.stock).toBe(40)
      expect(pub.availability).toBe('IN_STOCK')
      expect(pub.isAvailable).toBe(true)

      const log = await latestLog(pLife, 'adminops-add')
      expect(log).toMatchObject({
        operation: 'ADD_STOCK',
        previousQuantity: 25,
        newQuantity: 40,
        quantityChange: 15,
        previousReserved: 0,
        newReserved: 0,
        actorId: adminId,
        actorEmail: adminEmail,
        orderId: null,
      })

      const audit = await latestAudit(inv.id, INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED)
      expect(audit).not.toBeNull()
      expect(audit!.actorId).toBe(adminId)
      expect(audit!.metadata).toMatchObject({
        productId: pLife,
        operation: 'ADD_STOCK',
        quantity: 15,
        previousQuantity: 25,
        newQuantity: 40,
        reason: 'adminops-add',
      })
    })

    it('REMOVE_STOCK updates inventory + Product.stock, availability, history and audit', async () => {
      const res = await adjust(pLife, {
        operation: 'REMOVE_STOCK',
        quantity: 5,
        reason: 'adminops-remove',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(35)

      const inv = await dbInv(pLife)
      expect(inv.availableQuantity).toBe(35)
      expect((await dbProduct(pLife)).stock).toBe(35)

      const pub = await publicView(pLife)
      expect(pub.stock).toBe(35)
      expect(pub.availability).toBe('IN_STOCK')
      expect(pub.isAvailable).toBe(true)

      const log = await latestLog(pLife, 'adminops-remove')
      expect(log).toMatchObject({
        operation: 'REMOVE_STOCK',
        previousQuantity: 40,
        newQuantity: 35,
        quantityChange: -5,
        newReserved: 0,
        actorEmail: adminEmail,
      })

      const audit = await latestAudit(inv.id, INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED)
      expect(audit!.metadata).toMatchObject({
        operation: 'REMOVE_STOCK',
        previousQuantity: 40,
        newQuantity: 35,
      })
    })

    it('MANUAL_ADJUSTMENT sets an absolute target and records the delta', async () => {
      const res = await adjust(pLife, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 18,
        reason: 'adminops-manual',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(18)

      const inv = await dbInv(pLife)
      expect(inv.availableQuantity).toBe(18)
      expect((await dbProduct(pLife)).stock).toBe(18)

      const pub = await publicView(pLife)
      expect(pub.stock).toBe(18)
      expect(pub.availability).toBe('IN_STOCK')
      expect(pub.isAvailable).toBe(true)

      const log = await latestLog(pLife, 'adminops-manual')
      expect(log).toMatchObject({
        operation: 'MANUAL_ADJUSTMENT',
        previousQuantity: 35,
        newQuantity: 18,
        quantityChange: -17,
        newReserved: 0,
      })

      const audit = await latestAudit(inv.id, INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED)
      expect(audit!.metadata).toMatchObject({
        operation: 'MANUAL_ADJUSTMENT',
        previousQuantity: 35,
        newQuantity: 18,
        reason: 'adminops-manual',
      })
    })

    it('the public listing reports the same availability as the detail view', async () => {
      const res = await request(app).get(`/api/v1/products?search=${encodeURIComponent(pLifeSku)}`)
      expect(res.status).toBe(200)
      const item = res.body.items.find((i: any) => i.id === pLife)
      expect(item).toBeDefined()
      expect(item.stock).toBe(18)
      expect(item.availability).toBe('IN_STOCK')
      expect(item.isAvailable).toBe(true)
    })

    it('history returns newest-first entries with operation, quantities, reserved and reason', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${pLife}/history?limit=50`)
        .set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.total).toBeGreaterThanOrEqual(3)

      const reasons = res.body.items.map((l: any) => l.reason)
      expect(reasons).toContain('adminops-add')
      expect(reasons).toContain('adminops-remove')
      expect(reasons).toContain('adminops-manual')

      for (const item of res.body.items) {
        expect(item.productId).toBe(pLife)
        expect(typeof item.operation).toBe('string')
        expect(typeof item.previousQuantity).toBe('number')
        expect(typeof item.newQuantity).toBe('number')
        expect(typeof item.previousReserved).toBe('number')
        expect(typeof item.newReserved).toBe('number')
        expect(item.orderId).toBeNull()
      }

      const timestamps = res.body.items.map((l: any) => new Date(l.createdAt).getTime())
      expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a))
    })
  })

  // =========================================================================
  // 2. RESTOCK (returns sold units to available)
  // =========================================================================
  describe('RESTOCK returns sold units to available', () => {
    it('credits available, decrements sold, syncs product and logs + audits', async () => {
      await InventoryService.reserveStock([{ productId: pRestock, quantity: 4 }], {
        orderNumber: `ADMINOPS-RESTOCK-SEED-${ts}`,
      })
      await InventoryService.confirmDeduction([{ productId: pRestock, quantity: 4 }], {
        orderNumber: `ADMINOPS-RESTOCK-SEED-${ts}`,
      })
      const before = await dbInv(pRestock)
      expect(before.availableQuantity).toBe(6)
      expect(before.soldQuantity).toBe(4)

      const res = await adjust(pRestock, {
        operation: 'RESTOCK',
        quantity: 4,
        reason: 'adminops-restock',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(10)

      const after = await dbInv(pRestock)
      expect(after.availableQuantity).toBe(10)
      expect(after.soldQuantity).toBe(0)
      expect(after.reservedQuantity).toBe(0)
      expect((await dbProduct(pRestock)).stock).toBe(10)

      const pub = await publicView(pRestock)
      expect(pub.stock).toBe(10)
      expect(pub.availability).toBe('LOW_STOCK')
      expect(pub.isAvailable).toBe(true)

      const log = await latestLog(pRestock, 'adminops-restock')
      expect(log).toMatchObject({
        operation: 'RESTOCK',
        previousQuantity: 6,
        newQuantity: 10,
        quantityChange: 4,
      })

      const audit = await latestAudit(after.id, INVENTORY_AUDIT_ACTIONS.STOCK_RESTOCKED)
      expect(audit).not.toBeNull()
      expect(audit!.metadata).toMatchObject({ operation: 'RESTOCK', quantity: 4 })
    })
  })

  // =========================================================================
  // 3. LOW-STOCK AND OUT-OF-STOCK TRANSITIONS (status + availability)
  // =========================================================================
  describe('Low-stock and out-of-stock transitions', () => {
    it('raising the threshold above available flips to LOW_STOCK everywhere', async () => {
      const res = await patch(pThreshold, {
        reorderThreshold: 25,
        notes: 'adminops-threshold',
      })
      expect(res.status).toBe(200)
      expect(res.body.status).toBe(InventoryStatus.LOW_STOCK)
      expect(res.body.isLowStock).toBe(true)

      const inv = await dbInv(pThreshold)
      expect(inv.reorderThreshold).toBe(25)
      expect(inv.status).toBe(InventoryStatus.LOW_STOCK)

      const pub = await publicView(pThreshold)
      expect(pub.stock).toBe(20)
      expect(pub.availability).toBe('LOW_STOCK')
      expect(pub.isAvailable).toBe(true)

      const log = await latestLog(pThreshold, 'adminops-threshold')
      expect(log).toMatchObject({ operation: 'MANUAL_ADJUSTMENT', quantityChange: 0 })
      expect((log!.metadata as any).newThreshold).toBe(25)

      const audit = await latestAudit(inv.id, INVENTORY_AUDIT_ACTIONS.INVENTORY_ADJUSTED)
      expect(audit).not.toBeNull()
    })

    it('adding stock above the threshold restores IN_STOCK', async () => {
      const res = await adjust(pThreshold, {
        operation: 'ADD_STOCK',
        quantity: 6,
        reason: 'adminops-restore',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(26)
      expect(res.body.status).toBe(InventoryStatus.IN_STOCK)

      const pub = await publicView(pThreshold)
      expect(pub.availability).toBe('IN_STOCK')
      expect(pub.isAvailable).toBe(true)
      expect((await dbInv(pThreshold)).status).toBe(InventoryStatus.IN_STOCK)
    })

    it('draining to zero is OUT_OF_STOCK in DB, admin view, detail and listing', async () => {
      const res = await adjust(pThreshold, {
        operation: 'REMOVE_STOCK',
        quantity: 26,
        reason: 'adminops-drain',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(0)
      expect(res.body.status).toBe(InventoryStatus.OUT_OF_STOCK)
      expect(res.body.isOutOfStock).toBe(true)

      const inv = await dbInv(pThreshold)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.status).toBe(InventoryStatus.OUT_OF_STOCK)
      expect((await dbProduct(pThreshold)).stock).toBe(0)

      const pub = await publicView(pThreshold)
      expect(pub.stock).toBe(0)
      expect(pub.availability).toBe('OUT_OF_STOCK')
      expect(pub.isAvailable).toBe(false)

      const lowStock = await request(app)
        .get('/api/v1/admin/inventory/low-stock?limit=100')
        .set('Authorization', `Bearer ${adminToken}`)
      expect(lowStock.status).toBe(200)
      const found = lowStock.body.items.find((i: any) => i.productId === pThreshold)
      expect(found).toBeDefined()
      expect(found.isOutOfStock).toBe(true)
    })

    it('a product created at zero stock is OUT_OF_STOCK on the storefront', async () => {
      const inv = await dbInv(pOos)
      expect(inv.availableQuantity).toBe(0)
      expect(inv.status).toBe(InventoryStatus.OUT_OF_STOCK)

      const pub = await publicView(pOos)
      expect(pub.stock).toBe(0)
      expect(pub.availability).toBe('OUT_OF_STOCK')
      expect(pub.isAvailable).toBe(false)
    })

    it('restocking an out-of-stock product below threshold yields LOW_STOCK', async () => {
      const res = await adjust(pOos, {
        operation: 'ADD_STOCK',
        quantity: 5,
        reason: 'adminops-revive',
      })
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(5)
      expect(res.body.status).toBe(InventoryStatus.LOW_STOCK)
      expect(res.body.isOutOfStock).toBe(false)

      const pub = await publicView(pOos)
      expect(pub.stock).toBe(5)
      expect(pub.availability).toBe('LOW_STOCK')
      expect(pub.isAvailable).toBe(true)
    })
  })

  // =========================================================================
  // 4. GUARD RAILS: INVALID QUANTITIES & INSUFFICIENT STOCK
  // =========================================================================
  describe('Rejecting negative stock and invalid quantities', () => {
    it.each([
      ['zero quantity', { operation: 'ADD_STOCK', quantity: 0 }],
      ['negative quantity', { operation: 'ADD_STOCK', quantity: -5 }],
      ['fractional quantity', { operation: 'ADD_STOCK', quantity: 1.5 }],
      ['non-numeric quantity', { operation: 'ADD_STOCK', quantity: 'definitely-not-a-number' }],
      ['huge quantity', { operation: 'ADD_STOCK', quantity: Number.MAX_SAFE_INTEGER }],
      ['unknown operation', { operation: 'TELEPORT_STOCK', quantity: 1 }],
      ['negative threshold', { operation: 'ADD_STOCK', quantity: 1, reorderThreshold: -1 }],
    ])('rejects %s with 400 and leaves the row untouched', async (_label, payload) => {
      const before = await dbInv(pNeg)
      const logsBefore = await prisma.inventoryLog.count({ where: { productId: pNeg } })

      const res = await adjust(pNeg, payload as Record<string, unknown>)
      expect(res.status).toBe(400)

      const after = await dbInv(pNeg)
      expect(after.availableQuantity).toBe(before.availableQuantity)
      expect((await dbProduct(pNeg)).stock).toBe(before.availableQuantity)
      expect(await prisma.inventoryLog.count({ where: { productId: pNeg } })).toBe(logsBefore)
    })

    it('rejects an addition that would overflow the 32-bit inventory column', async () => {
      const res = await adjust(pNeg, {
        operation: 'ADD_STOCK',
        quantity: 2_147_483_647,
        reason: 'adminops-overflow',
      })
      expect(res.status).toBe(400)

      const after = await dbInv(pNeg)
      expect(after.availableQuantity).toBe(5)
      expect((await dbProduct(pNeg)).stock).toBe(5)
    })

    it('rejects removing more than available without mutating stock', async () => {
      const before = await dbInv(pNeg)
      const logsBefore = await prisma.inventoryLog.count({ where: { productId: pNeg } })

      const res = await adjust(pNeg, {
        operation: 'REMOVE_STOCK',
        quantity: before.availableQuantity + 1,
        reason: 'adminops-overremove',
      })
      expect(res.status).toBe(400)

      const after = await dbInv(pNeg)
      expect(after.availableQuantity).toBe(before.availableQuantity)
      expect(after.availableQuantity).toBeGreaterThanOrEqual(0)
      expect(await prisma.inventoryLog.count({ where: { productId: pNeg } })).toBe(logsBefore)
    })

    it('rejects a negative threshold on PATCH', async () => {
      const res = await patch(pNeg, { reorderThreshold: -5 })
      expect(res.status).toBe(400)
      expect((await dbInv(pNeg)).reorderThreshold).toBe(10)
    })

    it('rejects an unknown product with 404', async () => {
      const res = await adjust('does-not-exist-product', {
        operation: 'ADD_STOCK',
        quantity: 1,
      })
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // 5. AUTHORIZATION
  // =========================================================================
  describe('Unauthorized modification is blocked', () => {
    it('anonymous is unauthenticated (401) and writes nothing', async () => {
      const before = await dbInv(pNeg)
      const logsBefore = await prisma.inventoryLog.count({ where: { productId: pNeg } })

      const post = await request(app)
        .post(`/api/v1/admin/inventory/${pNeg}/adjust`)
        .send({ operation: 'ADD_STOCK', quantity: 1 })
      expect(post.status).toBe(401)

      const patchRes = await request(app)
        .patch(`/api/v1/admin/inventory/${pNeg}`)
        .send({ reorderThreshold: 99 })
      expect(patchRes.status).toBe(401)

      expect((await dbInv(pNeg)).availableQuantity).toBe(before.availableQuantity)
      expect(await prisma.inventoryLog.count({ where: { productId: pNeg } })).toBe(logsBefore)
    })

    it('customer is forbidden (403) from adjusting and patching', async () => {
      const before = await dbInv(pNeg)

      const post = await adjust(pNeg, { operation: 'ADD_STOCK', quantity: 1 }, customerToken)
      expect(post.status).toBe(403)

      const patchRes = await patch(pNeg, { reorderThreshold: 99 }, customerToken)
      expect(patchRes.status).toBe(403)

      expect((await dbInv(pNeg)).availableQuantity).toBe(before.availableQuantity)
    })

    it('permission-less staff is forbidden (403) from adjusting and patching', async () => {
      const before = await dbInv(pNeg)

      const post = await adjust(pNeg, { operation: 'ADD_STOCK', quantity: 1 }, restrictedStaffToken)
      expect(post.status).toBe(403)

      const patchRes = await patch(pNeg, { reorderThreshold: 99 }, restrictedStaffToken)
      expect(patchRes.status).toBe(403)

      expect((await dbInv(pNeg)).availableQuantity).toBe(before.availableQuantity)
      expect((await dbInv(pNeg)).reorderThreshold).toBe(10)
    })

    it('seeded staff WITH inventory permissions can adjust', async () => {
      const res = await adjust(pStaff, { operation: 'ADD_STOCK', quantity: 2, reason: 'staff-add' }, staffToken)
      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(10)
      expect((await dbProduct(pStaff)).stock).toBe(10)
    })
  })

  // =========================================================================
  // 6. IDEMPOTENCY
  // =========================================================================
  describe('Idempotency — no double-apply', () => {
    it('re-applying the same MANUAL_ADJUSTMENT does not accumulate', async () => {
      await adjust(pIdem, { operation: 'ADD_STOCK', quantity: 10, reason: 'adminops-idem-add' })
      expect((await dbInv(pIdem)).availableQuantity).toBe(20)

      const first = await adjust(pIdem, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 12,
        reason: 'adminops-idem-1',
      })
      expect(first.status).toBe(200)
      expect(first.body.availableQuantity).toBe(12)

      const second = await adjust(pIdem, {
        operation: 'MANUAL_ADJUSTMENT',
        quantity: 12,
        reason: 'adminops-idem-2',
      })
      expect(second.status).toBe(200)
      expect(second.body.availableQuantity).toBe(12)

      const inv = await dbInv(pIdem)
      expect(inv.availableQuantity).toBe(12)
      expect((await dbProduct(pIdem)).stock).toBe(12)

      const secondLog = await latestLog(pIdem, 'adminops-idem-2')
      expect(secondLog).toMatchObject({
        operation: 'MANUAL_ADJUSTMENT',
        previousQuantity: 12,
        newQuantity: 12,
        quantityChange: 0,
      })
    })

    it('restockOrder is idempotent per order reference', async () => {
      const order = await prisma.order.create({
        data: {
          orderNumber: `IAO-IDEM-${ts}`,
          userId: adminId,
          customerName: 'Inventory AdminOps Idempotency',
          customerEmail: 'inv-adminops-idem@vedhicfoods.com',
          phone: phoneFor(2),
          subtotal: 300,
          total: 300,
          paymentMethod: 'COD',
        },
      })
      orderIds.push(order.id)

      await InventoryService.reserveStock([{ productId: pIdem, quantity: 3 }], {
        orderId: order.id,
      })
      await InventoryService.confirmDeduction([{ productId: pIdem, quantity: 3 }], {
        orderId: order.id,
      })
      const before = await dbInv(pIdem)
      expect(before.availableQuantity).toBe(9)
      expect(before.soldQuantity).toBe(3)

      const first = await InventoryService.restockOrder([{ productId: pIdem, quantity: 3 }], {
        orderId: order.id,
      })
      expect(first.restockedItems).toHaveLength(1)
      const afterFirst = await dbInv(pIdem)
      expect(afterFirst.availableQuantity).toBe(12)
      expect(afterFirst.soldQuantity).toBe(0)

      const replay = await InventoryService.restockOrder([{ productId: pIdem, quantity: 3 }], {
        orderId: order.id,
      })
      expect(replay.restockedItems).toHaveLength(0)

      const afterSecond = await dbInv(pIdem)
      expect(afterSecond.availableQuantity).toBe(12)
      expect(afterSecond.soldQuantity).toBe(0)
      expect(afterSecond.reservedQuantity).toBe(0)

      const restockLogs = await prisma.inventoryLog.count({
        where: { productId: pIdem, orderId: order.id, operation: 'RESTOCK' },
      })
      expect(restockLogs).toBe(1)
      expect((await dbProduct(pIdem)).stock).toBe(12)
    })
  })

  // =========================================================================
  // 7. CONCURRENCY
  // =========================================================================
  describe('Concurrency: no oversell and no lost updates', () => {
    it('parallel reservations never oversell the 6 available units', async () => {
      const attempts = 12
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, (_, i) =>
          InventoryService.reserveStock([{ productId: pConc, quantity: 1 }], {
            orderNumber: `IAO-CONC-${ts}-${i}`,
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

    it('parallel ADD_STOCK adjustments do not lose increments', async () => {
      const adds = await Promise.all(
        Array.from({ length: 10 }, () =>
          adjust(pConc2, { operation: 'ADD_STOCK', quantity: 5, reason: 'adminops-conc-add' })
        )
      )
      expect(adds.every((r) => r.status === 200)).toBe(true)

      const inv = await dbInv(pConc2)
      expect(inv.availableQuantity).toBe(150)
      expect((await dbProduct(pConc2)).stock).toBe(150)
    }, 60000)

    it('parallel REMOVE_STOCK adjustments do not lose decrements', async () => {
      const removes = await Promise.all(
        Array.from({ length: 10 }, () =>
          adjust(pConc2, { operation: 'REMOVE_STOCK', quantity: 2, reason: 'adminops-conc-remove' })
        )
      )
      expect(removes.every((r) => r.status === 200)).toBe(true)

      const inv = await dbInv(pConc2)
      expect(inv.availableQuantity).toBe(130)
      expect(inv.availableQuantity).toBeGreaterThanOrEqual(0)
      expect((await dbProduct(pConc2)).stock).toBe(130)

      const addLogs = await prisma.inventoryLog.count({
        where: { productId: pConc2, reason: 'adminops-conc-add' },
      })
      const removeLogs = await prisma.inventoryLog.count({
        where: { productId: pConc2, reason: 'adminops-conc-remove' },
      })
      expect(addLogs).toBe(10)
      expect(removeLogs).toBe(10)
    }, 60000)

    it('parallel reservations and admin adjustments converge on an exact quantity', async () => {
      const product = await createProduct('MIXED', 20)
      const [adjustRes] = await Promise.all([
        adjust(product.id, { operation: 'ADD_STOCK', quantity: 10, reason: 'adminops-mixed-add' }),
        InventoryService.reserveStock([{ productId: product.id, quantity: 5 }], {
          orderNumber: `IAO-MIXED-${ts}`,
        }),
      ])
      expect(adjustRes.status).toBe(200)

      // 20 - 5 reserved + 10 adjusted = 25 available, 5 reserved.
      const inv = await dbInv(product.id)
      expect(inv.availableQuantity).toBe(25)
      expect(inv.reservedQuantity).toBe(5)
      expect((await dbProduct(product.id)).stock).toBe(25)

      await InventoryService.releaseReservation([{ productId: product.id, quantity: 5 }])
      const released = await dbInv(product.id)
      expect(released.availableQuantity).toBe(30)
      expect(released.reservedQuantity).toBe(0)
    }, 60000)
  })
})
