import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InventoryService } from '../../src/services/inventory.service'
import { InventoryStatus } from '@prisma/client'

const app = createApp()

describe('Production Inventory Management Integration Tests', () => {
  let adminToken: string
  let customerToken: string
  let unauthorizedStaffToken: string
  let testProductId: string
  let testProductSku: string
  let outOfStockProductId: string
  let categoryId = ''
  let customerId = ''
  let failureOrderId = ''
  let successOrderId = ''
  let customerEmail = ''
  const timestamp = Date.now()

  // Guest checkout rows persist across runs, so both the email and the phone
  // must be run-unique: `phone` is a unique user column, and a repeat of a
  // previously-used number makes guest identity resolution throw a P2002.
  const guestPhone = (n: number) => `9${String(timestamp).slice(-8)}${n}`

  beforeAll(async () => {
    // 1. Admin login
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    const category = await prisma.category.create({
      data: { name: `Inventory Test ${timestamp}`, slug: `inventory-test-${timestamp}` },
    })
    categoryId = category.id

    // 2. Customer login/register
    customerEmail = `inv.customer.${timestamp}@vedhicfoods.com`
    const customerReg = await AuthService.register({
      fullName: 'Inventory Customer',
      email: customerEmail,
      password: 'Customer@Vedhic2026!',
    })
    customerToken = customerReg.accessToken
    customerId = customerReg.user.id
    customerEmail = customerReg.user.email

    // 3. Unauthorized staff user (has no inventory.read or inventory.update)
    const unauthorizedStaffEmail = `staff.unauth.${timestamp}@vedhicfoods.com`
    await prisma.user.create({
      data: {
        email: unauthorizedStaffEmail,
        fullName: 'Restricted Staff Member',
        passwordHash: await AuthService.hashPassword('Staff@Vedhic2026!'),
        role: 'STAFF',
        isActive: true,
      },
    })
    const unauthLogin = await AuthService.login({
      email: unauthorizedStaffEmail,
      password: 'Staff@Vedhic2026!',
    })
    unauthorizedStaffToken = unauthLogin.accessToken

    // 4. Create primary test product with initial stock 25
    testProductSku = `SKU-INV-TEST-${timestamp}`
    const prodRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Organic A2 Bilona Ghee ${timestamp}`,
        sku: testProductSku,
        price: 850,
        mrp: 999,
        stock: 25,
        unit: '500ml',
        categoryId,
        shortDescription: 'Pure traditional cow ghee',
        description: 'Cultured A2 cow ghee prepared via bilona method',
        isOrganic: true,
      })
    expect(prodRes.status).toBe(201)
    testProductId = prodRes.body.id

    // 5. Create out of stock test product
    const oosRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Rare Himalayan Shilajit ${timestamp}`,
        sku: `SKU-OOS-${timestamp}`,
        price: 1500,
        mrp: 1800,
        stock: 0,
        unit: '50g',
        categoryId,
        shortDescription: 'Purified mineral resin',
      })
    expect(oosRes.status).toBe(201)
    outOfStockProductId = oosRes.body.id

    const createFixtureOrder = (label: string) => prisma.order.create({
      data: {
        orderNumber: `INV-${label}-${timestamp}`,
        userId: customerId,
        customerName: 'Inventory Customer',
        customerEmail,
        phone: guestPhone(0),
        subtotal: 100,
        total: 100,
      },
    })
    failureOrderId = (await createFixtureOrder('FAILURE')).id
    successOrderId = (await createFixtureOrder('SUCCESS')).id
  }, 45000)

  afterAll(async () => {
    const orderIds = [failureOrderId, successOrderId].filter(Boolean)
    if (orderIds.length) {
      await prisma.inventoryLog.deleteMany({ where: { orderId: { in: orderIds } } })
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    }
    // Clean up test products
    if (testProductId) {
      await prisma.inventoryLog.deleteMany({ where: { productId: testProductId } })
      await prisma.inventory.deleteMany({ where: { productId: testProductId } })
      await prisma.product.deleteMany({ where: { id: testProductId } })
    }
    if (outOfStockProductId) {
      await prisma.inventoryLog.deleteMany({ where: { productId: outOfStockProductId } })
      await prisma.inventory.deleteMany({ where: { productId: outOfStockProductId } })
      await prisma.product.deleteMany({ where: { id: outOfStockProductId } })
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } })
  })

  // =========================================================================
  // 1. RBAC & PERMISSION SAFEGUARDS
  // =========================================================================
  describe('RBAC & Permission Safeguards', () => {
    it('Customer should be FORBIDDEN from viewing admin inventory (403)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory')
        .set('Authorization', `Bearer ${customerToken}`)

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    })

    it('Staff without inventory permissions should be FORBIDDEN from viewing inventory (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${unauthorizedStaffToken}`)

      expect(res.status).toBe(403)
      // Permission slugs are deliberately not echoed to clients (reconnaissance).
      expect(res.body.error).toContain('Forbidden')
    })

    it('Staff without inventory.update should be FORBIDDEN from adjusting stock (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${testProductId}/adjust`)
        .set('Authorization', `Bearer ${unauthorizedStaffToken}`)
        .send({
          operation: 'ADD_STOCK',
          quantity: 10,
          reason: 'Unauthorized test adjustment',
        })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('Forbidden')
    })

    it('Admin with full inventory permissions should be ALLOWED access (200 OK)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items).toBeInstanceOf(Array)
      expect(res.body.total).toBeGreaterThan(0)
    })
  })

  // =========================================================================
  // 2. STOCK ADJUSTMENTS & REORDER THRESHOLD (ADMIN APIs)
  // =========================================================================
  describe('Admin Inventory APIs & Stock Adjustments', () => {
    it('GET /api/v1/admin/inventory/:productId should return authoritative quantities', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.productId).toBe(testProductId)
      expect(res.body.availableQuantity).toBe(25)
      expect(res.body.reservedQuantity).toBe(0)
      expect(res.body.totalStock).toBe(25)
      expect(res.body.reorderThreshold).toBe(10)
      expect(res.body.status).toBe(InventoryStatus.IN_STOCK)
    })

    it('POST /api/v1/admin/inventory/:productId/adjust should ADD stock', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${testProductId}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          operation: 'ADD_STOCK',
          quantity: 15,
          reason: 'New warehouse shipment arrived',
        })

      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(40) // 25 + 15
      expect(res.body.totalStock).toBe(40)
      expect(res.body.status).toBe(InventoryStatus.IN_STOCK)
    })

    it('POST /api/v1/admin/inventory/:productId/adjust should REMOVE stock', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${testProductId}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          operation: 'REMOVE_STOCK',
          quantity: 5,
          reason: 'Quality assurance sampling',
        })

      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(35) // 40 - 5
      expect(res.body.totalStock).toBe(35)
    })

    it('POST /api/v1/admin/inventory/:productId/adjust should reject NEGATIVE stock removal', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${testProductId}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          operation: 'REMOVE_STOCK',
          quantity: 999, // Exceeds available stock (35)
          reason: 'Excess removal test',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Cannot remove')
    })

    it('POST /api/v1/admin/inventory/:productId/adjust should perform MANUAL_ADJUSTMENT target target quantity', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${testProductId}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          operation: 'MANUAL_ADJUSTMENT',
          quantity: 20,
          reason: 'Physical inventory audit reconciliation',
        })

      expect(res.status).toBe(200)
      expect(res.body.availableQuantity).toBe(20)
      expect(res.body.totalStock).toBe(20)
    })

    it('PATCH /api/v1/admin/inventory/:productId should update low-stock threshold', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reorderThreshold: 25, // Available is 20, so threshold 25 makes it LOW_STOCK!
          notes: 'Increased threshold for festive season',
        })

      expect(res.status).toBe(200)
      expect(res.body.reorderThreshold).toBe(25)
      expect(res.body.status).toBe(InventoryStatus.LOW_STOCK)
      expect(res.body.isLowStock).toBe(true)
    })

    it('GET /api/v1/admin/inventory/low-stock should include products with low stock', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory/low-stock')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      const found = res.body.items.find((item: any) => item.productId === testProductId)
      expect(found).toBeDefined()
      expect(found.isLowStock).toBe(true)
    })

    it('GET /api/v1/admin/inventory/:productId/history should return detailed audit log entries', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${testProductId}/history`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.items).toBeInstanceOf(Array)
      expect(res.body.total).toBeGreaterThanOrEqual(4)

      const firstLog = res.body.items[0]
      expect(firstLog.productId).toBe(testProductId)
      expect(firstLog.operation).toBeDefined()
      expect(firstLog.createdAt).toBeDefined()
    })
  })

  // =========================================================================
  // 3. ZERO STOCK & PUBLIC STOREFRONT AVAILABILITY
  // =========================================================================
  describe('Zero Stock & Public Storefront Presentation', () => {
    it('Public storefront API should represent OUT_OF_STOCK product accurately', async () => {
      const res = await request(app).get(`/api/v1/products/${outOfStockProductId}`)

      expect(res.status).toBe(200)
      expect(res.body.stock).toBe(0)
      expect(res.body.availability).toBe('OUT_OF_STOCK')
      expect(res.body.isAvailable).toBe(false)
    })

    it('Checkout should REJECT ordering an out-of-stock product', async () => {
      const res = await request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Kavita Rao',
          customerEmail: `kavita.rao.${timestamp}@example.com`,
          phone: guestPhone(1),
          addressLine: '12 Banjara Hills',
          city: 'Hyderabad',
          state: 'Telangana',
          pincode: '500034',
          paymentMethod: 'COD',
          items: [
            {
              productId: outOfStockProductId,
              quantity: 1,
            },
          ],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('out of stock')
    })
  })

  // =========================================================================
  // 4. CART AUTHORITATIVE INVENTORY VALIDATION
  // =========================================================================
  describe('Cart Authoritative Inventory Checks', () => {
    const sessionToken = `guest_cart_session_${Date.now()}`

    it('POST /api/v1/cart/items should add available items to cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('x-session-token', sessionToken)
        .send({
          productId: testProductId,
          quantity: 2,
        })

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].quantity).toBe(2)
      expect(res.body.items[0].inventory.isAvailable).toBe(true)
    })

    it('POST /api/v1/cart/items should REJECT adding out-of-stock product to cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('x-session-token', sessionToken)
        .send({
          productId: outOfStockProductId,
          quantity: 1,
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('out of stock')
    })

    it('POST /api/v1/cart/items should REJECT exceeding available stock in cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('x-session-token', sessionToken)
        .send({
          productId: testProductId,
          quantity: 500, // Available is 20
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('exceeds authoritative available stock')
    })

    it('POST /api/v1/cart/validate should return valid when cart items are in stock', async () => {
      const res = await request(app)
        .post('/api/v1/cart/validate')
        .set('x-session-token', sessionToken)

      expect(res.status).toBe(200)
      expect(res.body.isValid).toBe(true)
      expect(res.body.issues).toHaveLength(0)
    })
  })

  // =========================================================================
  // 5. TRANSACTIONAL CHECKOUT & CONCURRENT RESERVATION
  // =========================================================================
  describe('Transactional Checkout & Concurrency Control', () => {
    it('POST /api/v1/orders/checkout should reserve and deduct stock atomically', async () => {
      // First reset test product stock to 10
      await request(app)
        .post(`/api/v1/admin/inventory/${testProductId}/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          operation: 'MANUAL_ADJUSTMENT',
          quantity: 10,
          reason: 'Set baseline for checkout test',
        })

      const checkoutRes = await request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Rohan Sharma',
          customerEmail: `rohan.sharma.${timestamp}@example.com`,
          phone: guestPhone(2),
          addressLine: '123 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          paymentMethod: 'COD',
          items: [
            {
              productId: testProductId,
              quantity: 4,
            },
          ],
        })

      expect(checkoutRes.status).toBe(201)
      expect(checkoutRes.body.success).toBe(true)

      // Verify stock was deducted: was 10, bought 4 -> now 6
      const invRes = await request(app)
        .get(`/api/v1/admin/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(invRes.body.availableQuantity).toBe(6)
      expect(invRes.body.soldQuantity).toBeGreaterThanOrEqual(4)
    })

    it('Concurrent reservation should safely prevent overselling and race conditions', async () => {
      // Available stock is currently 6. We run two parallel checkout requests for 4 units each.
      // 4 + 4 = 8 > 6, so exactly ONE must succeed and ONE must fail with 400!
      const req1 = request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Concurrent Buyer 1',
          customerEmail: `concurrent1.${timestamp}@example.com`,
          phone: guestPhone(3),
          addressLine: '1 Test Street',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          paymentMethod: 'COD',
          items: [{ productId: testProductId, quantity: 4 }],
        })

      const req2 = request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Concurrent Buyer 2',
          customerEmail: `concurrent2.${timestamp}@example.com`,
          phone: guestPhone(4),
          addressLine: '2 Test Street',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
          paymentMethod: 'COD',
          items: [{ productId: testProductId, quantity: 4 }],
        })

      const [res1, res2] = await Promise.all([req1, req2])

      const statuses = [res1.status, res2.status].sort()
      // One 201 Created and one 400 Bad Request (Insufficient Stock)
      expect(statuses).toEqual([201, 400])

      // Verify remaining stock is 6 - 4 = 2 (NOT negative!)
      const invRes = await request(app)
        .get(`/api/v1/admin/inventory/${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`)

      expect(invRes.body.availableQuantity).toBe(2)
      expect(invRes.body.availableQuantity).toBeGreaterThanOrEqual(0)
    })
  })

  // =========================================================================
  // 6. ORDER CANCELLATION RESTOCK & FAILED PAYMENT RELEASE
  // =========================================================================
  describe('Order Cancellation Restock & Payment Lifecycle', () => {
    let cancellableOrderId: string
    let initialAvailable: number

    beforeAll(async () => {
      // Check current available stock
      const inv = await InventoryService.getInventoryByProductId(testProductId)
      initialAvailable = inv.availableQuantity

      // Place an order for 2 items
      const res = await request(app)
        .post('/api/v1/orders/checkout')
        .send({
          customerName: 'Cancellation Test Customer',
          customerEmail: `cancel.customer.${timestamp}@example.com`,
          phone: guestPhone(5),
          addressLine: '3 Cancel Street',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          paymentMethod: 'COD',
          items: [{ productId: testProductId, quantity: 2 }],
        })

      expect(res.status).toBe(201)
      cancellableOrderId = res.body.orderId
    })

    it('POST /api/v1/orders/:id/cancel should restock inventory', async () => {
      // Available stock before cancellation was initialAvailable - 2
      const res = await request(app)
        .post(`/api/v1/orders/${cancellableOrderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Customer changed delivery address' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify stock was restored by 2
      const invAfter = await InventoryService.getInventoryByProductId(testProductId)
      expect(invAfter.availableQuantity).toBe(initialAvailable)
    })

    it('Duplicate order cancellation should be REJECTED (Idempotency check)', async () => {
      const res = await request(app)
        .post(`/api/v1/orders/${cancellableOrderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Accidental duplicate cancellation' })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('already cancelled')
    })

    it('Payment failure should release reserved stock', async () => {
      // Test direct reservation and release cycle
      const stockBefore = (await InventoryService.getInventoryByProductId(testProductId)).availableQuantity

      // 1. Manually reserve 2 units
      await InventoryService.reserveStock(
        [{ productId: testProductId, quantity: 2 }],
        { orderId: failureOrderId, orderNumber: `INV-FAILURE-${timestamp}` }
      )

      const stockDuring = (await InventoryService.getInventoryByProductId(testProductId)).availableQuantity
      expect(stockDuring).toBe(stockBefore - 2)

      // 2. Release reservation (simulating payment failure/cancellation)
      await InventoryService.releaseReservation(
        [{ productId: testProductId, quantity: 2 }],
        { orderId: failureOrderId, reason: 'Customer payment gateway timeout' }
      )

      const stockAfter = (await InventoryService.getInventoryByProductId(testProductId)).availableQuantity
      expect(stockAfter).toBe(stockBefore)
    })

    it('Payment success should finalize deduction from reserved stock', async () => {
      const stockBefore = (await InventoryService.getInventoryByProductId(testProductId)).availableQuantity

      // 1. Reserve 1 unit
      await InventoryService.reserveStock(
        [{ productId: testProductId, quantity: 1 }],
        { orderId: successOrderId }
      )

      // 2. Confirm deduction
      await InventoryService.confirmDeduction(
        [{ productId: testProductId, quantity: 1 }],
        { orderId: successOrderId, reason: 'Captured Razorpay payment' }
      )

      const invAfter = await InventoryService.getInventoryByProductId(testProductId)
      expect(invAfter.availableQuantity).toBe(stockBefore - 1)
      expect(invAfter.reservedQuantity).toBe(0)
    })
  })
})
