import './_safety'
import crypto from 'crypto'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { resolveRazorpayCredentials } from '../../src/integrations/razorpay/razorpay.client'
import { OrderStatus, PaymentStatus, PaymentMethod } from '@prisma/client'

const app = createApp()

describe('Production Checkout & Order Creation Workflow Integration Tests', () => {
  let adminToken: string
  let customerAToken: string
  let customerAId: string
  let customerBToken: string
  let customerBId: string
  let customerAAddressId: string
  let customerBAddressId: string
  let inStockProductId: string
  let outOfStockProductId: string
  let categoryId: string

  const timestamp = Date.now()

  beforeAll(async () => {
    // 1. Admin login
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    // 2. Customer A
    const emailA = `checkout.alice.${timestamp}@vedhicfoods.com`
    const regA = await AuthService.register({
      fullName: 'Alice Checkout',
      email: emailA,
      password: 'AliceCheckout@Vedhic2026!',
    })
    customerAToken = regA.accessToken
    customerAId = regA.user.id

    // 3. Customer B
    const emailB = `checkout.bob.${timestamp}@vedhicfoods.com`
    const regB = await AuthService.register({
      fullName: 'Bob Checkout',
      email: emailB,
      password: 'BobCheckout@Vedhic2026!',
    })
    customerBToken = regB.accessToken
    customerBId = regB.user.id

    // 4. Provision Category
    const catRes = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Checkout Category ${timestamp}`,
        slug: `checkout-cat-${timestamp}`,
      })
    categoryId = catRes.body.id || catRes.body.category?.id || catRes.body.data?.id

    // 5. Create in-stock product (Price: 350, MRP: 400, Stock: 20)
    const p1 = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Wild Forest Honey ${timestamp}`,
        slug: `wild-honey-${timestamp}`,
        sku: `SKU-HONEY-${timestamp}`,
        categoryId,
        price: 350,
        mrp: 400,
        stock: 20,
      })
    inStockProductId = p1.body.id || p1.body.product?.id || p1.body.data?.id

    // 6. Create out-of-stock product (Price: 200, MRP: 250, Stock: 0)
    const p2 = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Sold Out Herb ${timestamp}`,
        slug: `sold-out-${timestamp}`,
        sku: `SKU-SOLDOUT-${timestamp}`,
        categoryId,
        price: 200,
        mrp: 250,
        stock: 0,
      })
    outOfStockProductId = p2.body.id || p2.body.product?.id || p2.body.data?.id

    // 7. Create saved address for Customer A
    const addrARes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerAToken}`)
      .send({
        fullName: 'Alice Sharma',
        phone: '9876543210',
        line1: 'Flat 502, Lotus Towers',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
      })
    customerAAddressId = addrARes.body.data.id

    // 8. Create saved address for Customer B
    const addrBRes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerBToken}`)
      .send({
        fullName: 'Bob Verma',
        phone: '9876543211',
        line1: 'House 14, Sector 7',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560001',
      })
    customerBAddressId = addrBRes.body.data.id
  })

  afterAll(async () => {
    // Cleanup
    await prisma.orderItem.deleteMany({
      where: { order: { userId: { in: [customerAId, customerBId] } } },
    }).catch(() => {})

    await prisma.payment.deleteMany({
      where: { order: { userId: { in: [customerAId, customerBId] } } },
    }).catch(() => {})

    // Invoices are generated when a payment is confirmed; they reference the
    // order with a restrictive FK, so they must be removed before the orders.
    await prisma.invoice.deleteMany({
      where: { order: { userId: { in: [customerAId, customerBId] } } },
    }).catch(() => {})

    await prisma.order.deleteMany({
      where: { userId: { in: [customerAId, customerBId] } },
    }).catch(() => {})

    await prisma.cartItem.deleteMany({
      where: { product: { id: { in: [inStockProductId, outOfStockProductId] } } },
    }).catch(() => {})

    await prisma.address.deleteMany({
      where: { userId: { in: [customerAId, customerBId] } },
    }).catch(() => {})

    await prisma.product.deleteMany({
      where: { id: { in: [inStockProductId, outOfStockProductId] } },
    }).catch(() => {})

    await prisma.user.deleteMany({
      where: { id: { in: [customerAId, customerBId] } },
    }).catch(() => {})
  })

  // =========================================================================
  // 1. VALIDATION GATES: AUTH, CART, ADDRESS, INVENTORY, PRICING
  // =========================================================================
  describe('Checkout Pre-condition Validation & Security Guards', () => {
    it('POST /api/v1/checkout should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .send({ addressId: customerAAddressId })

      expect(res.status).toBe(401)
    })

    it('POST /api/v1/checkout should reject empty cart checkout with 400', async () => {
      // Customer B has empty cart and provides no items
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerBToken}`)
        .send({ addressId: customerBAddressId })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('empty cart')
    })

    it('POST /api/v1/checkout should reject checkout when using another customer address (Ownership Check)', async () => {
      // Customer A tries to use Customer B's address
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerBAddressId,
          items: [{ productId: inStockProductId, quantity: 1 }],
        })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('not authorized')
    })

    it('POST /api/v1/checkout should reject checkout with non-existent address ID', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: '00000000-0000-0000-0000-000000000000',
          items: [{ productId: inStockProductId, quantity: 1 }],
        })

      expect(res.status).toBe(404)
    })

    it('POST /api/v1/checkout should reject checkout if product is out of stock', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: outOfStockProductId, quantity: 1 }],
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('out of stock')
    })

    it('POST /api/v1/checkout should reject checkout if requested quantity exceeds available stock', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: inStockProductId, quantity: 50 }], // Stock is 20
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Insufficient stock')
    })

    it('POST /api/v1/checkout should IGNORE frontend price manipulation and compute authoritative totals', async () => {
      // Product price is 350. Client tries to send fake price: 10
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: inStockProductId, quantity: 1 }],
          price: 10, // FAKE
          discount: 100, // FAKE
          subtotal: 10, // FAKE
          total: 10, // FAKE
          paymentMethod: 'COD',
        })

      expect(res.status).toBe(201)
      expect(res.body.success).toBe(true)

      // Subtotal: 350 (authoritative)
      // Shipping: 49 (350 < 499)
      // Tax: 5% of 350 = 17.5
      // Total: 350 + 49 + 17.5 = 416.5
      expect(res.body.subtotal).toBe(350)
      expect(res.body.shipping).toBe(49)
      expect(res.body.tax).toBe(17.5)
      expect(res.body.total).toBe(416.5)
      expect(res.body.items[0].price).toBe(350)
    })
  })

  // =========================================================================
  // 2. ORDER CREATION, ADDRESS SNAPSHOT & ORDER NUMBER
  // =========================================================================
  describe('Order Creation, Address Snapshot & Order Number Integrity', () => {
    let createdOrderNumber: string
    let createdOrderId: string

    it('POST /api/v1/checkout should create order with VF-YYYY-NNNNNN order number and immutable address snapshot', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: inStockProductId, quantity: 2 }], // 2 * 350 = 700 (Free Shipping)
          paymentMethod: 'COD',
        })

      expect(res.status).toBe(201)
      expect(res.body.orderNumber).toMatch(/^VF-\d{4}-\d{6}$/)
      createdOrderNumber = res.body.orderNumber
      createdOrderId = res.body.orderId
      expect(createdOrderId).toBeDefined()

      // Verify subtotal >= 499 gets free shipping
      expect(res.body.subtotal).toBe(700)
      expect(res.body.shipping).toBe(0)
      expect(res.body.tax).toBe(35) // 5% of 700 = 35
      expect(res.body.total).toBe(735)

      // Verify address snapshot
      expect(res.body.shippingAddress.line1).toBe('Flat 502, Lotus Towers')
      expect(res.body.shippingAddress.city).toBe('Hyderabad')
      expect(res.body.shippingAddress.pincode).toBe('500081')
    })

    it('Modifying saved address later must NOT change the historical order address snapshot', async () => {
      // Customer A updates their saved address
      await request(app)
        .patch(`/api/v1/customer/addresses/${customerAAddressId}`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          line1: 'Completely New Address Line 999',
          city: 'Mumbai',
          pincode: '400001',
        })

      // Fetch the order placed previously
      const orderRes = await request(app)
        .get(`/api/v1/orders/${createdOrderNumber}`)
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(orderRes.status).toBe(200)
      const shipping = orderRes.body.order?.shippingAddressSnapshot || orderRes.body.shippingAddressSnapshot
      // Historical address snapshot in order remains untouched!
      expect(shipping.line1).toBe('Flat 502, Lotus Towers')
      expect(shipping.city).toBe('Hyderabad')
      expect(shipping.pincode).toBe('500081')
    })
  })

  // =========================================================================
  // 3. IDEMPOTENCY STRATEGY: PREVENT DUPLICATE ORDERS ON DOUBLE-CLICK
  // =========================================================================
  describe('Idempotency & Duplicate Order Prevention', () => {
    it('Should return existing order on duplicate checkout with same idempotency key without duplicate creation', async () => {
      const idempotencyKey = `idemp-key-${timestamp}`

      // First checkout request
      const firstRes = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: inStockProductId, quantity: 1 }],
          paymentMethod: 'COD',
        })

      expect(firstRes.status).toBe(201)
      const firstOrderId = firstRes.body.orderId
      const firstOrderNumber = firstRes.body.orderNumber

      // Second checkout request with the exact same idempotency key (Simulating user double-clicking)
      const secondRes = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .set('X-Idempotency-Key', idempotencyKey)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: inStockProductId, quantity: 1 }],
          paymentMethod: 'COD',
        })

      expect(secondRes.status).toBe(200)
      expect(secondRes.headers['x-idempotent-replay']).toBe('true')
      expect(secondRes.body.orderId).toBe(firstOrderId)
      expect(secondRes.body.orderNumber).toBe(firstOrderNumber)

      // Verify in DB that only 1 order exists with this idempotency key
      const count = await prisma.order.count({
        where: { idempotencyKey },
      })
      expect(count).toBe(1)
    })
  })

  // =========================================================================
  // 4. PAYMENT PREPARATION & ORDER STATES
  // =========================================================================
  describe('Payment Preparation, Non-Paid Checkout & State Machine Transitions', () => {
    let onlineOrderId: string

    it('Online checkout (RAZORPAY) must start in PENDING_PAYMENT with PENDING payment (not marked paid)', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          items: [{ productId: inStockProductId, quantity: 1 }],
          paymentMethod: 'RAZORPAY',
        })

      expect(res.status).toBe(201)
      expect(res.body.status).toBe(OrderStatus.PENDING_PAYMENT)
      expect(res.body.paymentStatus).toBe(PaymentStatus.PENDING) // NOT marked paid!
      // Razorpay order creation is deliberately deferred to
      // POST /api/v1/payments/razorpay/order so checkout stays atomic.
      expect(res.body.paymentDetails).not.toBeNull()
      expect(res.body.paymentDetails?.razorpayOrderId).toBeUndefined()
      onlineOrderId = res.body.orderId

      // Verify payment record in DB
      const paymentRecord = await prisma.payment.findUnique({
        where: { orderId: onlineOrderId },
      })
      expect(paymentRecord).toBeDefined()
      expect(paymentRecord?.status).toBe('PENDING')
      expect(paymentRecord?.method).toBe(PaymentMethod.RAZORPAY)
    })

    it('PATCH /api/v1/orders/:id/status should REJECT invalid state transitions', async () => {
      // Trying to transition PENDING_PAYMENT directly to DELIVERED -> Invalid!
      const res = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.DELIVERED })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Invalid order status transition')
    })

    it('POST /api/v1/orders/:id/confirm-payment should transition PENDING_PAYMENT to CONFIRMED and mark payment PAID', async () => {
      const order = await prisma.order.findUnique({ where: { id: onlineOrderId } })
      expect(order).not.toBeNull()

      const rzpOrderId = `order_conf${timestamp}`
      const rzpPaymentId = `pay_conf${timestamp}`

      await prisma.payment.update({
        where: { orderId: onlineOrderId },
        data: { razorpayOrderId: rzpOrderId },
      })

      // The effective gateway credentials are resolved from the admin-configured
      // payment settings when present and only fall back to the environment. Sign
      // with the same secret the handler will use, and stub the gateway call on
      // that exact client instance rather than the environment singleton. The
      // cross-check cannot reach Razorpay from a test environment, so the stub
      // reports a settled payment for this order.
      const session = await resolveRazorpayCredentials()
      const gatewaySpy = vi
        .spyOn(session.client.payments, 'fetch')
        .mockImplementation(async (paymentId: string) =>
          ({
            id: paymentId,
            entity: 'payment',
            amount: Math.round(Number(order!.total) * 100),
            currency: 'INR',
            status: 'captured',
            order_id: rzpOrderId,
            method: 'upi',
          }) as any
        )

      const signature = crypto
        .createHmac('sha256', session.keySecret)
        .update(`${rzpOrderId}|${rzpPaymentId}`)
        .digest('hex')

      const res = await request(app)
        .post(`/api/v1/orders/${onlineOrderId}/confirm-payment`)
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: rzpPaymentId,
          razorpaySignature: signature,
        })

      gatewaySpy.mockRestore()

      expect(res.status).toBe(200)

      const updatedOrder = await prisma.order.findUnique({
        where: { id: onlineOrderId },
      })
      expect(updatedOrder?.status).toBe(OrderStatus.CONFIRMED)
      expect(updatedOrder?.paymentStatus).toBe(PaymentStatus.PAID)
    })

    it('PATCH /api/v1/orders/:id/status should follow sequential valid lifecycle transitions', async () => {
      // CONFIRMED -> PROCESSING
      const step1 = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PROCESSING })
      expect(step1.status).toBe(200)

      // PROCESSING -> PACKED
      const step2 = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PACKED })
      expect(step2.status).toBe(200)

      // PACKED -> SHIPPED
      const step3 = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.SHIPPED })
      expect(step3.status).toBe(200)

      // SHIPPED -> OUT_FOR_DELIVERY
      const step4 = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.OUT_FOR_DELIVERY })
      expect(step4.status).toBe(200)

      // OUT_FOR_DELIVERY -> DELIVERED
      const step5 = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.DELIVERED })
      expect(step5.status).toBe(200)

      // DELIVERED is terminal: cannot transition back to PROCESSING
      const invalidTerminal = await request(app)
        .patch(`/api/v1/orders/${onlineOrderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: OrderStatus.PROCESSING })
      expect(invalidTerminal.status).toBe(400)
    })
  })

  // =========================================================================
  // 5. CART TO CHECKOUT INTEGRATION & AUTOMATIC CART CLEARING
  // =========================================================================
  describe('Cart-based Checkout & Automatic Cart Item Cleanup', () => {
    it('Checkout without items in request body should checkout user PostgreSQL cart and clear items', async () => {
      // 1. Add item to Customer A's cart
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({ productId: inStockProductId, quantity: 1 })
      expect(addRes.status).toBe(200)
      expect(addRes.body.itemCount).toBe(1)

      // 2. Perform checkout without passing items array (Cart -> Checkout)
      const checkoutRes = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerAToken}`)
        .send({
          addressId: customerAAddressId,
          paymentMethod: 'COD',
        })

      expect(checkoutRes.status).toBe(201)
      expect(checkoutRes.body.items.length).toBe(1)
      expect(checkoutRes.body.items[0].productId).toBe(inStockProductId)

      // 3. Verify Customer A's cart in PostgreSQL was automatically emptied!
      const cartAfter = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerAToken}`)

      expect(cartAfter.status).toBe(200)
      expect(cartAfter.body.itemCount).toBe(0)
      expect(cartAfter.body.items.length).toBe(0)
    })
  })
})
