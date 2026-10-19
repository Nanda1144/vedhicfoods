import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { DeliveryStatus, OrderStatus, PaymentStatus } from '@prisma/client'

const app = createApp()

/**
 * Extended delivery-management coverage.
 *
 * Complements delivery.test.ts with:
 *  - the full valid transition matrix (including assignment-skipping and recovery routes)
 *  - the full invalid / terminal transition matrix
 *  - inventory correctness on RETURNED/CANCELLED (single restock, no double-credit)
 *  - optimistic concurrency for racing status transitions
 *  - order/delivery status consistency at every step
 *  - RBAC + customer ownership + audit trail
 */
describe('Delivery Management — Extended State Machine', () => {
  let adminToken: string
  let staffToken: string
  let staffId: string
  let inactiveStaffId: string
  let customerToken: string
  let customerId: string
  let otherCustomerToken: string
  let otherCustomerId: string
  let addressId: string
  let categoryId: string

  let pMain: string
  let pCancel: string
  let pFail: string
  let pReturn: string
  let pConc: string

  const ts = Date.now()

  async function createProduct(name: string) {
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `${name} ${ts}`,
        slug: `${name.toLowerCase()}-${ts}-${Math.random().toString(36).slice(2, 7)}`,
        sku: `SKU-${name}-${ts}-${Math.random().toString(36).slice(2, 7)}`,
        categoryId,
        price: 200,
        mrp: 250,
        stock: 20,
      })
    return res.body.id || res.body.product?.id || res.body.data?.id
  }

  async function createStaff(email: string, active: boolean) {
    const user = await prisma.user.create({
      data: {
        email,
        fullName: 'Delivery Extended Staff',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: 'STAFF',
        phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
        isActive: active,
      },
    })
    const staffRole = await prisma.role.findFirst({ where: { name: 'STAFF' } })
    if (staffRole) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: staffRole.id } })
    }
    return user.id
  }

  async function createOrder(productId: string, qty = 1) {
    const res = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        addressId,
        items: [{ productId, quantity: qty }],
        paymentMethod: 'COD',
      })
    if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`)
    const orderNumber = res.body.orderNumber
    const order = await prisma.order.findUnique({ where: { orderNumber } })
    return { orderNumber, orderId: order!.id }
  }

  const transition = (orderNumber: string, status: DeliveryStatus, token = adminToken, notes?: string) =>
    request(app)
      .patch(`/api/v1/admin/delivery/${orderNumber}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status, ...(notes ? { notes } : {}) })

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    staffId = await createStaff(`delivery.ext.staff.${ts}@vedhicfoods.com`, true)
    inactiveStaffId = await createStaff(`delivery.ext.inactive.${ts}@vedhicfoods.com`, false)
    const staffLogin = await AuthService.login({
      email: `delivery.ext.staff.${ts}@vedhicfoods.com`,
      password: 'Staff@Vedhic2026!',
    })
    staffToken = staffLogin.accessToken

    const cust = await AuthService.register({
      fullName: 'Delivery Extended Customer',
      email: `delivery.ext.cust.${ts}@vedhicfoods.com`,
      password: 'CustExtended@Vedhic2026!',
    })
    customerToken = cust.accessToken
    customerId = cust.user.id

    const other = await AuthService.register({
      fullName: 'Delivery Other Customer',
      email: `delivery.ext.other.${ts}@vedhicfoods.com`,
      password: 'OtherExtended@Vedhic2026!',
    })
    otherCustomerToken = other.accessToken
    otherCustomerId = other.user.id

    const catRes = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Delivery Extended Cat ${ts}`, slug: `delivery-ext-cat-${ts}` })
    categoryId = catRes.body.id || catRes.body.category?.id || catRes.body.data?.id

    pMain = await createProduct('MainPath')
    pCancel = await createProduct('CancelPath')
    pFail = await createProduct('FailPath')
    pReturn = await createProduct('ReturnPath')
    pConc = await createProduct('ConcurrentPath')

    const addrRes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fullName: 'Delivery Extended Customer',
        phone: '9876511111',
        line1: '55 Delivery Road',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
      })
    addressId = addrRes.body.data.id
  }, 180000)

  afterAll(async () => {
    const userIds = [customerId, otherCustomerId, staffId, inactiveStaffId]
    const productIds = [pMain, pCancel, pFail, pReturn, pConc]

    await prisma.deliveryHistory.deleteMany({ where: { delivery: { order: { userId: { in: userIds } } } } }).catch(() => {})
    await prisma.delivery.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId: { in: productIds } } }).catch(() => {})
    await prisma.address.deleteMany({ where: { userId: { in: [customerId, otherCustomerId] } } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
  }, 180000)

  // -------------------------------------------------------------------------
  // 1. RBAC / AUTH
  // -------------------------------------------------------------------------
  describe('1. RBAC & authentication', () => {
    it('rejects every admin delivery endpoint without a token (401)', async () => {
      expect((await request(app).get('/api/v1/admin/delivery')).status).toBe(401)
      expect((await request(app).get('/api/v1/admin/delivery/x')).status).toBe(401)
      expect((await request(app).patch('/api/v1/admin/delivery/x').send({})).status).toBe(401)
      expect((await request(app).post('/api/v1/admin/delivery/x/assign').send({})).status).toBe(401)
      expect((await request(app).patch('/api/v1/admin/delivery/x/status').send({})).status).toBe(401)
    })

    it('rejects a customer lacking delivery permissions (403)', async () => {
      expect(
        (await request(app).get('/api/v1/admin/delivery').set('Authorization', `Bearer ${customerToken}`)).status
      ).toBe(403)
      expect(
        (
          await request(app)
            .patch('/api/v1/admin/delivery/anything/status')
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ status: 'PACKED' })
        ).status
      ).toBe(403)
    })

    it('allows delivery staff to list deliveries (200)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/delivery')
        .set('Authorization', `Bearer ${staffToken}`)
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.deliveries)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // 2. VALID TRANSITION MATRIX
  // -------------------------------------------------------------------------
  describe('2. Valid transition matrix & order-status synchronisation', () => {
    it('walks PENDING → ASSIGNED → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED', async () => {
      const { orderNumber } = await createOrder(pMain, 1)

      const assigned = await request(app)
        .post(`/api/v1/admin/delivery/${orderNumber}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: staffId, notes: 'Route A' })
      expect(assigned.status).toBe(200)
      expect(assigned.body.data.status).toBe(DeliveryStatus.ASSIGNED)
      expect((await prisma.order.findFirst({ where: { orderNumber } }))!.status).toBe(OrderStatus.PROCESSING)

      const packed = await transition(orderNumber, DeliveryStatus.PACKED)
      expect(packed.status).toBe(200)
      expect((await prisma.order.findFirst({ where: { orderNumber } }))!.status).toBe(OrderStatus.PACKED)

      const shipped = await transition(orderNumber, DeliveryStatus.SHIPPED)
      expect(shipped.status).toBe(200)
      expect((await prisma.order.findFirst({ where: { orderNumber } }))!.status).toBe(OrderStatus.SHIPPED)

      const ofd = await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)
      expect(ofd.status).toBe(200)
      expect((await prisma.order.findFirst({ where: { orderNumber } }))!.status).toBe(OrderStatus.OUT_FOR_DELIVERY)

      const delivered = await transition(orderNumber, DeliveryStatus.DELIVERED)
      expect(delivered.status).toBe(200)
      expect(delivered.body.data.deliveredAt).toBeTruthy()

      const order = await prisma.order.findFirst({ where: { orderNumber }, include: { payment: true } })
      expect(order!.status).toBe(OrderStatus.DELIVERED)
      // COD captured on delivery.
      expect(order!.paymentStatus).toBe(PaymentStatus.PAID)
      expect(order!.payment!.status).toBe('CAPTURED')
    })

    it('allows PENDING → PACKED (skipping assignment) then SHIPPED → OUT_FOR_DELIVERY → DELIVERED', async () => {
      const { orderNumber } = await createOrder(pMain, 1)

      const packed = await transition(orderNumber, DeliveryStatus.PACKED)
      expect(packed.status).toBe(200)

      const shipped = await transition(orderNumber, DeliveryStatus.SHIPPED)
      expect(shipped.status).toBe(200)

      const ofd = await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)
      expect(ofd.status).toBe(200)

      const delivered = await transition(orderNumber, DeliveryStatus.DELIVERED)
      expect(delivered.status).toBe(200)
    })
  })

  // -------------------------------------------------------------------------
  // 3. FAILURE / RECOVERY & RETURN ROUTE
  // -------------------------------------------------------------------------
  describe('3. Failure, recovery & return routes', () => {
    it('supports SHIPPED → FAILED → OUT_FOR_DELIVERY recovery', async () => {
      const { orderNumber } = await createOrder(pFail, 1)

      expect((await transition(orderNumber, DeliveryStatus.PACKED)).status).toBe(200)
      expect((await transition(orderNumber, DeliveryStatus.SHIPPED)).status).toBe(200)
      expect((await transition(orderNumber, DeliveryStatus.FAILED)).status).toBe(200)

      const recovery = await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)
      expect(recovery.status).toBe(200)
      expect(recovery.body.data.status).toBe(DeliveryStatus.OUT_FOR_DELIVERY)
      // Order is kept in sync with the recovered delivery state.
      expect((await prisma.order.findFirst({ where: { orderNumber } }))!.status).toBe(
        OrderStatus.OUT_FOR_DELIVERY
      )
    })

    it('restocks exactly once when an OUT_FOR_DELIVERY order is RETURNED', async () => {
      const base = (await prisma.product.findUnique({ where: { id: pReturn } }))!.stock
      const { orderNumber } = await createOrder(pReturn, 1)

      await transition(orderNumber, DeliveryStatus.PACKED)
      await transition(orderNumber, DeliveryStatus.SHIPPED)
      await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)

      const returned = await transition(orderNumber, DeliveryStatus.RETURNED)
      expect(returned.status).toBe(200)

      const afterReturn = (await prisma.product.findUnique({ where: { id: pReturn } }))!.stock
      expect(afterReturn).toBe(base) // 1 unit credited back

      // RETURNED → CANCELLED is allowed, but must NOT restock a second time.
      const cancelled = await transition(orderNumber, DeliveryStatus.CANCELLED)
      expect(cancelled.status).toBe(200)

      const afterCancel = (await prisma.product.findUnique({ where: { id: pReturn } }))!.stock
      expect(afterCancel).toBe(base) // still exactly one credit, never base + 1
    })
  })

  // -------------------------------------------------------------------------
  // 4. INVALID / TERMINAL TRANSITION MATRIX
  // -------------------------------------------------------------------------
  describe('4. Invalid & terminal transitions', () => {
    let orderNumber: string

    beforeAll(async () => {
      ;({ orderNumber } = await createOrder(pCancel, 1))
    })

    it('rejects PENDING → DELIVERED (completion without fulfilment) with 400', async () => {
      const res = await transition(orderNumber, DeliveryStatus.DELIVERED)
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid delivery transition/i)
    })

    it('rejects PENDING → SHIPPED and PENDING → OUT_FOR_DELIVERY (400)', async () => {
      expect((await transition(orderNumber, DeliveryStatus.SHIPPED)).status).toBe(400)
      expect((await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)).status).toBe(400)
    })

    it('rejects an unknown status value (400)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${orderNumber}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'TELEPORTED' })
      expect(res.status).toBe(400)
    })

    it('rejects duplicate update to the current status (400)', async () => {
      const res = await transition(orderNumber, DeliveryStatus.PENDING)
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/duplicate update/i)
    })

    it('rejects PACKED → OUT_FOR_DELIVERY and SHIPPED → DELIVERED skips (400)', async () => {
      expect((await transition(orderNumber, DeliveryStatus.PACKED)).status).toBe(200)
      expect((await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)).status).toBe(400)

      expect((await transition(orderNumber, DeliveryStatus.SHIPPED)).status).toBe(200)
      expect((await transition(orderNumber, DeliveryStatus.DELIVERED)).status).toBe(400)
    })

    it('treats DELIVERED as terminal (400 on any further change)', async () => {
      expect((await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)).status).toBe(200)
      expect((await transition(orderNumber, DeliveryStatus.DELIVERED)).status).toBe(200)

      const toPending = await transition(orderNumber, DeliveryStatus.PENDING)
      expect(toPending.status).toBe(400)
      const toCancelled = await transition(orderNumber, DeliveryStatus.CANCELLED)
      expect(toCancelled.status).toBe(400)
    })

    it('treats CANCELLED as terminal', async () => {
      const { orderNumber: on } = await createOrder(pCancel, 1)
      expect((await transition(on, DeliveryStatus.CANCELLED)).status).toBe(200)

      const res = await transition(on, DeliveryStatus.DELIVERED)
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/cancelled/i)
    })

    it('rejects RETURNED → DELIVERED and FAILED → DELIVERED (400)', async () => {
      const { orderNumber: on } = await createOrder(pCancel, 1)
      await transition(on, DeliveryStatus.PACKED)
      await transition(on, DeliveryStatus.SHIPPED)
      await transition(on, DeliveryStatus.OUT_FOR_DELIVERY)
      await transition(on, DeliveryStatus.RETURNED)
      expect((await transition(on, DeliveryStatus.DELIVERED)).status).toBe(400)

      const { orderNumber: on2 } = await createOrder(pCancel, 1)
      await transition(on2, DeliveryStatus.PACKED)
      await transition(on2, DeliveryStatus.SHIPPED)
      await transition(on2, DeliveryStatus.FAILED)
      expect((await transition(on2, DeliveryStatus.DELIVERED)).status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // 5. INVENTORY DISPOSITION ON CANCELLATION
  // -------------------------------------------------------------------------
  describe('5. Cancellation inventory disposition', () => {
    it('restocks a CONFIRMED (deducted) order when its delivery is cancelled', async () => {
      const base = (await prisma.product.findUnique({ where: { id: pCancel } }))!.stock
      const { orderNumber } = await createOrder(pCancel, 1)

      const deducted = (await prisma.product.findUnique({ where: { id: pCancel } }))!.stock
      expect(deducted).toBe(base - 1)

      const res = await transition(orderNumber, DeliveryStatus.CANCELLED)
      expect(res.status).toBe(200)

      const after = (await prisma.product.findUnique({ where: { id: pCancel } }))!.stock
      expect(after).toBe(base) // credited back exactly once
      expect((await prisma.order.findFirst({ where: { orderNumber } }))!.status).toBe(
        OrderStatus.CANCELLED
      )
    })
  })

  // -------------------------------------------------------------------------
  // 6. ASSIGNMENT RULES
  // -------------------------------------------------------------------------
  describe('6. Staff assignment rules', () => {
    it('rejects assignment to an inactive staff member (400)', async () => {
      const { orderNumber } = await createOrder(pCancel, 1)
      const res = await request(app)
        .post(`/api/v1/admin/delivery/${orderNumber}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: inactiveStaffId })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/does not exist or is inactive/i)
    })

    it('rejects assignment once the delivery has been delivered (400)', async () => {
      const { orderNumber } = await createOrder(pMain, 1)
      await transition(orderNumber, DeliveryStatus.PACKED)
      await transition(orderNumber, DeliveryStatus.SHIPPED)
      await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)
      await transition(orderNumber, DeliveryStatus.DELIVERED)

      const res = await request(app)
        .post(`/api/v1/admin/delivery/${orderNumber}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: staffId })
      expect(res.status).toBe(400)
    })
  })

  // -------------------------------------------------------------------------
  // 7. METADATA UPDATE GUARDS
  // -------------------------------------------------------------------------
  describe('7. Metadata update guards', () => {
    it('updates tracking metadata and mirrors it onto the order', async () => {
      const { orderNumber } = await createOrder(pMain, 1)
      const tracking = `TRK-EXT-${ts}`

      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${orderNumber}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ trackingNumber: tracking, courierPartner: 'Delhivery Extended', deliveryNotes: 'Ring bell' })

      expect(res.status).toBe(200)
      expect(res.body.data.trackingNumber).toBe(tracking)

      const order = await prisma.order.findFirst({ where: { orderNumber } })
      expect(order!.trackingNumber).toBe(tracking)
      expect(order!.courier).toBe('Delhivery Extended')
    })

    it('rejects metadata updates on a cancelled delivery (400)', async () => {
      const { orderNumber } = await createOrder(pCancel, 1)
      await transition(orderNumber, DeliveryStatus.CANCELLED)

      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${orderNumber}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ deliveryNotes: 'too late' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/cancelled/i)
    })
  })

  // -------------------------------------------------------------------------
  // 8. CONCURRENCY
  // -------------------------------------------------------------------------
  describe('8. Concurrent conflicting transitions', () => {
    it('serialises racing OUT_FOR_DELIVERY → DELIVERED / RETURNED so exactly one wins', async () => {
      const { orderNumber } = await createOrder(pConc, 1)
      await transition(orderNumber, DeliveryStatus.PACKED)
      await transition(orderNumber, DeliveryStatus.SHIPPED)
      await transition(orderNumber, DeliveryStatus.OUT_FOR_DELIVERY)

      const [a, b] = await Promise.all([
        transition(orderNumber, DeliveryStatus.DELIVERED),
        transition(orderNumber, DeliveryStatus.RETURNED),
      ])

      const winners = [a.status, b.status].filter((s) => s === 200)
      const losers = [a.status, b.status].filter((s) => s !== 200)

      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      expect([400, 409]).toContain(losers[0])

      const delivery = await prisma.delivery.findUnique({ where: { orderId: (await prisma.order.findFirst({ where: { orderNumber } }))!.id } })
      const order = await prisma.order.findFirst({ where: { orderNumber } })

      expect([DeliveryStatus.DELIVERED, DeliveryStatus.RETURNED]).toContain(delivery!.status)
      // Order remains consistent with whichever transition committed.
      if (delivery!.status === DeliveryStatus.DELIVERED) {
        expect(order!.status).toBe(OrderStatus.DELIVERED)
      } else {
        expect(order!.status).toBe(OrderStatus.OUT_FOR_DELIVERY)
      }
    })
  })

  // -------------------------------------------------------------------------
  // 9. CUSTOMER OWNERSHIP & AUDIT
  // -------------------------------------------------------------------------
  describe('9. Customer ownership & audit trail', () => {
    it('lets the owner track their delivery but masks it from other customers (404)', async () => {
      const { orderNumber } = await createOrder(pMain, 1)

      const own = await request(app)
        .get(`/api/v1/orders/${orderNumber}/delivery`)
        .set('Authorization', `Bearer ${customerToken}`)
      expect(own.status).toBe(200)
      expect(own.body.data.orderNumber).toBe(orderNumber)

      const other = await request(app)
        .get(`/api/v1/orders/${orderNumber}/delivery`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)

      // Anti-enumeration: ownership failures return the same 404 as a missing
      // order, so the caller cannot confirm the order exists.
      expect(other.status).toBe(404)
      expect(other.body.success).toBe(false)
      expect(other.body.error).toMatch(/not found/i)
      expect(other.body.data).toBeUndefined()
    })

    it('records assignment and status-change audit entries', async () => {
      const { orderNumber, orderId } = await createOrder(pMain, 1)

      await request(app)
        .post(`/api/v1/admin/delivery/${orderNumber}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: staffId })
      await transition(orderNumber, DeliveryStatus.PACKED)

      const delivery = await prisma.delivery.findUnique({ where: { orderId } })
      const audit = await prisma.auditLog.findMany({
        where: { entity: 'Delivery', entityId: delivery!.id },
      })
      const actions = audit.map((a) => a.action)
      expect(actions).toContain('DELIVERY_STAFF_ASSIGNED')
      expect(actions).toContain('DELIVERY_STATUS_CHANGED')

      const history = await prisma.deliveryHistory.findMany({
        where: { deliveryId: delivery!.id },
      })
      expect(history.map((h) => h.status)).toContain(DeliveryStatus.PACKED)
    })
  })
})
