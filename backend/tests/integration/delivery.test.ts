import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { DeliveryStatus, OrderStatus, PaymentStatus } from '@prisma/client'

const app = createApp()

describe('Delivery Management & Logistics Integration Tests', () => {
  let adminToken: string
  let deliveryStaffToken: string
  let deliveryStaffId: string
  let customerAToken: string
  let customerAId: string
  let customerBToken: string
  let customerBId: string

  let categoryId: string
  let testProductId: string
  let customerAAddressId: string
  let orderNumberA: string
  let orderIdA: string
  let deliveryIdA: string

  let orderNumberB: string
  let orderIdB: string

  const timestamp = Date.now()

  beforeAll(async () => {
    // 1. Admin login
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    const staffPhone = `91${(timestamp % 100000000).toString().padStart(8, '0')}`
    const phoneA = `98${((timestamp + 1) % 100000000).toString().padStart(8, '0')}`
    const phoneB = `97${((timestamp + 2) % 100000000).toString().padStart(8, '0')}`

    // 2. Create dedicated delivery staff member with delivery permissions
    const staffEmail = `delivery.staff.${timestamp}@vedhicfoods.com`
    const staffUser = await prisma.user.create({
      data: {
        email: staffEmail,
        fullName: 'Ramesh Courier Staff',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: 'STAFF',
        phone: staffPhone,
        isActive: true,
      },
    })
    deliveryStaffId = staffUser.id

    // Assign STAFF role (which includes delivery permissions)
    const staffRole = await prisma.role.findFirst({
      where: { name: 'STAFF' },
    })
    if (staffRole) {
      await prisma.userRole.create({
        data: {
          userId: deliveryStaffId,
          roleId: staffRole.id,
        },
      })
    }

    const staffLogin = await AuthService.login({
      email: staffEmail,
      password: 'Staff@Vedhic2026!',
    })
    deliveryStaffToken = staffLogin.accessToken

    // 3. Customer A
    const emailA = `customer.a.${timestamp}@vedhicfoods.com`
    const regA = await AuthService.register({
      fullName: 'Alice Delivery',
      email: emailA,
      password: 'CustomerA@Vedhic2026!',
      phone: phoneA,
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id

    // 4. Customer B
    const emailB = `customer.b.${timestamp}@vedhicfoods.com`
    const regB = await AuthService.register({
      fullName: 'Bob Delivery',
      email: emailB,
      password: 'CustomerB@Vedhic2026!',
      phone: phoneB,
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id

    // 5. Create category and test product
    const cat = await prisma.category.create({
      data: {
        name: `Delivery Category ${timestamp}`,
        slug: `delivery-cat-${timestamp}`,
      },
    })
    categoryId = cat.id

    const prod = await prisma.product.create({
      data: {
        name: `Organic Jaggery ${timestamp}`,
        slug: `organic-jaggery-${timestamp}`,
        sku: `SKU-JAGGERY-${timestamp}`,
        categoryId,
        price: 250,
        mrp: 300,
        stock: 50,
      },
    })
    testProductId = prod.id

    // 6. Create saved address for Customer A
    const addr = await prisma.address.create({
      data: {
        userId: customerAId,
        fullName: 'Alice Delivery',
        phone: '9876543210',
        line1: 'Flat 101, Vedhic Residency',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
        isDefault: true,
      },
    })
    customerAAddressId = addr.id

    // 7. Place an order for Customer A via checkout
    const checkoutRes = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        addressId: customerAAddressId,
        paymentMethod: 'COD',
        items: [{ productId: testProductId, quantity: 2 }],
        notes: 'Handle with care',
      })

    expect(checkoutRes.status).toBe(201)
    orderNumberA = checkoutRes.body.orderNumber || checkoutRes.body.order?.orderNumber
    orderIdA = checkoutRes.body.orderId || checkoutRes.body.order?.id

    const delA = await prisma.delivery.findUnique({
      where: { orderId: orderIdA },
    })
    if (delA) {
      deliveryIdA = delA.id
    }

    // 8. Place an order for Customer B via checkout
    const checkoutResB = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        address: {
          fullName: 'Bob Delivery',
          phone: phoneB,
          line1: '404 Green Valley',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
        paymentMethod: 'COD',
        items: [{ productId: testProductId, quantity: 1 }],
      })

    expect(checkoutResB.status).toBe(201)
    orderNumberB = checkoutResB.body.orderNumber || checkoutResB.body.order?.orderNumber
    orderIdB = checkoutResB.body.orderId || checkoutResB.body.order?.id
  }, 90000)

  afterAll(async () => {
    // Cleanup created data
    await prisma.deliveryHistory.deleteMany({
      where: {
        delivery: {
          order: {
            userId: { in: [customerAId, customerBId] },
          },
        },
      },
    }).catch(() => {})

    await prisma.delivery.deleteMany({
      where: {
        order: {
          userId: { in: [customerAId, customerBId] },
        },
      },
    }).catch(() => {})

    await prisma.orderItem.deleteMany({
      where: {
        order: {
          userId: { in: [customerAId, customerBId] },
        },
      },
    }).catch(() => {})

    await prisma.payment.deleteMany({
      where: {
        order: {
          userId: { in: [customerAId, customerBId] },
        },
      },
    }).catch(() => {})

    await prisma.order.deleteMany({
      where: {
        userId: { in: [customerAId, customerBId] },
      },
    }).catch(() => {})

    await prisma.address.deleteMany({
      where: { userId: customerAId },
    }).catch(() => {})

    await prisma.product.deleteMany({
      where: { id: testProductId },
    }).catch(() => {})

    await prisma.category.deleteMany({
      where: { id: categoryId },
    }).catch(() => {})

    await prisma.userRole.deleteMany({
      where: { userId: { in: [deliveryStaffId, customerAId, customerBId] } },
    }).catch(() => {})

    await prisma.user.deleteMany({
      where: { id: { in: [deliveryStaffId, customerAId, customerBId] } },
    }).catch(() => {})
  }, 90000)

  describe('1. Unauthorized Access & RBAC Controls', () => {
    it('GET /api/v1/admin/delivery should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/admin/delivery')
      expect(res.status).toBe(401)
    })

    it('GET /api/v1/admin/delivery should reject regular customers lacking delivery.read with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/delivery')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/Forbidden|Missing required permission/)
    })

    it('PATCH /api/v1/admin/delivery/:id/status should reject customer with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${orderNumberA}/status`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ status: 'PACKED' })

      expect(res.status).toBe(403)
    })

    it('POST /api/v1/admin/delivery/:id/assign should reject customer with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/delivery/${orderNumberA}/assign`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ assignedStaffId: deliveryStaffId })

      expect(res.status).toBe(403)
    })
  })

  describe('2. Delivery Provisioning, Listing & Detail Retrieval', () => {
    it('GET /api/v1/admin/delivery should allow delivery staff to list deliveries', async () => {
      const res = await request(app)
        .get('/api/v1/admin/delivery')
        .set('Authorization', `Bearer ${deliveryStaffToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(Array.isArray(res.body.deliveries)).toBe(true)
      expect(res.body.pagination).toBeDefined()
    })

    it('GET /api/v1/admin/delivery should support search filter by orderNumber', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/delivery?search=${orderNumberA}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.deliveries.length).toBeGreaterThanOrEqual(1)
      const found = res.body.deliveries.find((d: any) => d.orderNumber === orderNumberA)
      expect(found).toBeDefined()
      expect(found.status).toBe(DeliveryStatus.PENDING)
      deliveryIdA = found.id
    })

    it('GET /api/v1/admin/delivery/:id should retrieve detailed delivery by ID or orderNumber', async () => {
      // Fetch by deliveryId
      const resById = await request(app)
        .get(`/api/v1/admin/delivery/${deliveryIdA}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(resById.status).toBe(200)
      expect(resById.body.data.id).toBe(deliveryIdA)
      expect(resById.body.data.order.orderNumber).toBe(orderNumberA)
      expect(resById.body.data.order.itemsCount).toBe(1)
      expect(Array.isArray(resById.body.data.history)).toBe(true)

      // Fetch by orderNumber
      const resByNum = await request(app)
        .get(`/api/v1/admin/delivery/${orderNumberA}`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)

      expect(resByNum.status).toBe(200)
      expect(resByNum.body.data.id).toBe(deliveryIdA)
    })

    it('GET /api/v1/admin/delivery/:id should return 404 for missing orders/deliveries', async () => {
      const res = await request(app)
        .get('/api/v1/admin/delivery/VF-2099-999999')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(404)
    })
  })

  describe('3. Staff Assignment', () => {
    it('POST /api/v1/admin/delivery/:id/assign should reject non-existent staff with 400', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000'
      const res = await request(app)
        .post(`/api/v1/admin/delivery/${deliveryIdA}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: fakeUuid })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/does not exist|inactive/i)
    })

    it('POST /api/v1/admin/delivery/:id/assign should successfully assign staff and transition PENDING to ASSIGNED', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/delivery/${deliveryIdA}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          assignedStaffId: deliveryStaffId,
          notes: 'Assigned to South Zone route',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.assignedStaff).toBeDefined()
      expect(res.body.data.assignedStaff.id).toBe(deliveryStaffId)
      expect(res.body.data.status).toBe(DeliveryStatus.ASSIGNED)

      // Verify order transitioned from CONFIRMED to PROCESSING
      const dbOrder = await prisma.order.findUnique({ where: { id: orderIdA } })
      expect(dbOrder?.status).toBe(OrderStatus.PROCESSING)

      // Verify assignment history is logged
      const historyRes = res.body.data.history
      const assignEntry = historyRes.find((h: any) => h.status === DeliveryStatus.ASSIGNED)
      expect(assignEntry).toBeDefined()
      expect(assignEntry.assignedToId).toBe(deliveryStaffId)
    })
  })

  describe('4. Metadata Updates (Tracking Reference, Courier, Notes, Estimated Delivery)', () => {
    it('PATCH /api/v1/admin/delivery/:id should update tracking reference and delivery notes', async () => {
      const trackingNumber = `TRK-${timestamp}-DELHIVERY`
      const estimatedDelivery = new Date(Date.now() + 86400000 * 3).toISOString()

      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          courierPartner: 'Delhivery Surface',
          trackingNumber,
          trackingUrl: 'https://www.delhivery.com/track/package/TRK-TEST',
          estimatedDelivery,
          deliveryNotes: 'Gate code 4589',
        })

      expect(res.status).toBe(200)
      expect(res.body.data.trackingNumber).toBe(trackingNumber)
      expect(res.body.data.courierPartner).toBe('Delhivery Surface')
      expect(res.body.data.deliveryNotes).toContain('Gate code 4589')

      // Verify synchronization to Order table
      const order = await prisma.order.findUnique({ where: { id: orderIdA } })
      expect(order?.trackingNumber).toBe(trackingNumber)
      expect(order?.courier).toBe('Delhivery Surface')
    })
  })

  describe('5. Controlled Status Transitions, Order Synchronization & Duplicate Updates', () => {
    it('PATCH /api/v1/admin/delivery/:id/status should reject duplicate update with 400', async () => {
      // Current status is ASSIGNED, attempting to transition to ASSIGNED again
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.ASSIGNED })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/Duplicate update/i)
    })

    it('PATCH /api/v1/admin/delivery/:id/status should reject invalid skip transition with 400', async () => {
      // Cannot jump from ASSIGNED directly to DELIVERED
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.DELIVERED })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/Invalid delivery transition/i)
    })

    it('Transition ASSIGNED -> PACKED: synchronizes order to PACKED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.PACKED, notes: 'Items verified and boxed' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(DeliveryStatus.PACKED)

      const order = await prisma.order.findUnique({ where: { id: orderIdA } })
      expect(order?.status).toBe(OrderStatus.PACKED)
    })

    it('Transition PACKED -> SHIPPED: synchronizes order to SHIPPED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.SHIPPED, notes: 'Handed over to courier facility' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(DeliveryStatus.SHIPPED)

      const order = await prisma.order.findUnique({ where: { id: orderIdA } })
      expect(order?.status).toBe(OrderStatus.SHIPPED)
    })

    it('Transition SHIPPED -> OUT_FOR_DELIVERY: synchronizes order to OUT_FOR_DELIVERY', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.OUT_FOR_DELIVERY, notes: 'Driver out on route' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(DeliveryStatus.OUT_FOR_DELIVERY)

      const order = await prisma.order.findUnique({ where: { id: orderIdA } })
      expect(order?.status).toBe(OrderStatus.OUT_FOR_DELIVERY)
    })

    it('Transition OUT_FOR_DELIVERY -> DELIVERED: marks deliveredAt and captures COD payment', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.DELIVERED, notes: 'Signed by Alice' })

      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(DeliveryStatus.DELIVERED)
      expect(res.body.data.deliveredAt).toBeDefined()

      // Verify order status and payment status
      const order = await prisma.order.findUnique({
        where: { id: orderIdA },
        include: { payment: true },
      })
      expect(order?.status).toBe(OrderStatus.DELIVERED)
      // COD order payment automatically marked as PAID upon physical delivery
      expect(order?.paymentStatus).toBe(PaymentStatus.PAID)
      expect(order?.payment?.status).toBe('CAPTURED')
      expect(order?.payment?.verifiedAt).toBeDefined()
    })

    it('Terminal DELIVERED state: cannot modify delivery status once delivered', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/delivery/${deliveryIdA}/status`)
        .set('Authorization', `Bearer ${deliveryStaffToken}`)
        .send({ status: DeliveryStatus.CANCELLED })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/already DELIVERED|terminal state/i)
    })

    it('Terminal DELIVERED state: cannot assign staff to an already delivered order', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/delivery/${deliveryIdA}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ assignedStaffId: deliveryStaffId })

      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/already delivered/i)
    })
  })

  describe('6. Cancelled Orders & Inventory Synchronization', () => {
    it('Cancelling an order via API automatically cancels delivery record and restocks inventory', async () => {
      // Check initial inventory of test product
      const initialProd = await prisma.product.findUnique({ where: { id: testProductId } })
      const initialStock = initialProd!.stock

      // Cancel Customer B's order
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderIdB}/cancel`)
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ reason: 'Ordered by mistake' })

      expect(cancelRes.status).toBe(200)

      // Verify Delivery record was automatically marked CANCELLED
      const deliveryB = await prisma.delivery.findUnique({ where: { orderId: orderIdB } })
      expect(deliveryB?.status).toBe(DeliveryStatus.CANCELLED)

      // Verify stock was restored to PostgreSQL inventory
      const updatedProd = await prisma.product.findUnique({ where: { id: testProductId } })
      expect(updatedProd!.stock).toBe(initialStock + 1)

      // Attempting to update delivery status on a cancelled order must be rejected
      const updateRes = await request(app)
        .patch(`/api/v1/admin/delivery/${orderNumberB}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: DeliveryStatus.OUT_FOR_DELIVERY })

      expect(updateRes.status).toBe(400)
      expect(updateRes.body.error).toMatch(/cancelled/i)
    })
  })

  describe('7. Customer Ownership & Tracking Isolation', () => {
    it('GET /api/v1/orders/:id/delivery should allow Customer A to track their own order', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${orderNumberA}/delivery`)
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.orderNumber).toBe(orderNumberA)
      expect(res.body.data.status).toBe(DeliveryStatus.DELIVERED)
      expect(res.body.data.courierPartner).toBe('Delhivery Surface')
      expect(res.body.data.trackingNumber).toContain(`TRK-${timestamp}`)
      expect(Array.isArray(res.body.data.history)).toBe(true)
      expect(res.body.data.history.length).toBeGreaterThanOrEqual(1)
    })

    it('GET /api/v1/orders/:id/delivery should forbid Customer B from tracking Customer A order with 403', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${orderNumberA}/delivery`)
        .set('Authorization', `Bearer ${customerBToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/not authorized to view delivery information/i)
    })

    it('GET /api/v1/orders/:id/delivery should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/orders/${orderNumberA}/delivery`)
      expect(res.status).toBe(401)
    })
  })

  describe('8. Audit Trail Verification', () => {
    it('Status changes and assignments should create audit logs in PostgreSQL', async () => {
      const auditEntries = await prisma.auditLog.findMany({
        where: {
          entity: 'Delivery',
          entityId: deliveryIdA,
        },
      })

      expect(auditEntries.length).toBeGreaterThanOrEqual(2)
      const actions = auditEntries.map((a) => a.action)
      expect(actions).toContain('DELIVERY_STAFF_ASSIGNED')
      expect(actions).toContain('DELIVERY_STATUS_CHANGED')
    })
  })
})
