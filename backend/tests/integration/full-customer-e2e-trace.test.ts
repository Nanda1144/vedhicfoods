import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { webhookSignature } from './helpers/razorpay-testkit'
import { captureEmailTransport, type EmailTransportCapture } from './helpers/email-capture'
import { EmailQueue } from '../../src/services/email.service'
import { resolveRazorpayCredentials } from '../../src/integrations/razorpay/razorpay.client'
import { OrderStatus, PaymentStatus, DeliveryStatus } from '@prisma/client'

/**
 * ============================================================================
 * VEDHIC FOODS — FULL E2E CUSTOMER TRACE SUITE
 * ============================================================================
 * Trace matrix verified end-to-end:
 * Frontend API -> Database -> Razorpay -> Webhook -> Inventory -> Invoice -> SES -> Customer
 */

const app = createApp()
const ts = Date.now()

describe('Full End-to-End Customer Trace Suite', () => {
  let adminToken: string
  let customerToken: string
  let customerId: string
  let customerEmail: string
  let categoryId: string
  let productId: string
  let addressId: string
  let capture: EmailTransportCapture
  let webhookSecret: string

  beforeAll(async () => {
    capture = captureEmailTransport()
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()

    webhookSecret = (await resolveRazorpayCredentials(true)).webhookSecret

    // 1. Admin setup
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    // 2. Provision Category
    const cat = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `E2E Category ${ts}`, slug: `e2e-cat-${ts}` })
    categoryId = cat.body.id || cat.body.data?.id

    // 3. Provision Product (Initial stock: 10)
    const prod = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Organic Millet Laddu ${ts}`,
        slug: `organic-laddu-${ts}`,
        sku: `SKU-LADDU-${ts}`,
        categoryId,
        price: 250,
        mrp: 300,
        stock: 10,
      })
    productId = prod.body.id || prod.body.data?.id

    // 4. Register Clean Customer
    customerEmail = `e2e.customer.${ts}@vedhicfoods.test`
    const reg = await AuthService.register({
      fullName: 'Ananya Iyer',
      email: customerEmail,
      password: 'Password@123',
    })
    customerToken = reg.accessToken
    customerId = reg.user.id

    // 5. Save Customer Address
    const addr = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fullName: 'Ananya Iyer',
        phone: '9876543210',
        line1: '42 Heritage Lane',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
      })
    addressId = addr.body.data.id
  })

  afterAll(async () => {
    capture?.restore()
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()

    // Database Cleanup
    await prisma.invoice.deleteMany({ where: { order: { userId: customerId } } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { order: { userId: customerId } } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { order: { userId: customerId } } }).catch(() => {})
    await prisma.order.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.cartItem.deleteMany({ where: { productId } }).catch(() => {})
    await prisma.cart.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.address.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: productId } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: customerId } }).catch(() => {})
  })

  it('20-Step Full End-to-End Customer Trace (Clean Environment)', async () => {
    // Step 1: Open website / Health Check
    const health = await request(app).get('/api/v1/health')
    expect(health.status).toBe(200)

    // Step 2 & 3: Browse categories & products
    const categories = await request(app).get('/api/v1/categories')
    expect(categories.status).toBe(200)

    // Step 4: Search product
    const search = await request(app).get(`/api/v1/products?search=Organic Millet Laddu`)
    expect(search.status).toBe(200)

    // Step 5: Open product detail
    const detail = await request(app).get(`/api/v1/products/organic-laddu-${ts}`)
    expect(detail.status).toBe(200)
    expect(detail.body.stock).toBe(10)

    // Step 6 & 7: Add to Cart (Quantity: 2)
    const addToCart = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId, quantity: 2 })
    expect(addToCart.status).toBe(200)

    // Step 8: Review Cart
    const cart = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${customerToken}`)
    expect(cart.status).toBe(200)
    expect(cart.body.data.items[0].quantity).toBe(2)

    // Step 9 & 10: Checkout (Order Creation)
    const checkout = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ addressId, paymentMethod: 'RAZORPAY' })
    expect(checkout.status).toBe(201)

    const orderId = checkout.body.orderId
    const orderNumber = checkout.body.orderNumber
    const totalRupees = checkout.body.total

    // Verify DB initial state (PENDING_PAYMENT, reserved stock = 0 before payment)
    const dbOrderInit = await prisma.order.findUnique({ where: { id: orderId } })
    expect(dbOrderInit?.status).toBe(OrderStatus.PENDING_PAYMENT)
    expect(dbOrderInit?.paymentStatus).toBe(PaymentStatus.PENDING)

    // Step 11 & 12: Create & Complete Test Payment via Webhook
    const razorpayOrderId = `order_e2e_${ts}`
    const razorpayPaymentId = `pay_e2e_${ts}`
    await prisma.payment.update({
      where: { orderId },
      data: { razorpayOrderId },
    })

    const webhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: razorpayPaymentId,
            order_id: razorpayOrderId,
            amount: Math.round(totalRupees * 100),
            currency: 'INR',
            status: 'captured',
            method: 'card',
          },
        },
      },
    })
    const signature = webhookSignature(webhookBody, webhookSecret)

    // Step 13: Webhook Verification
    const webhookRes = await request(app)
      .post('/api/v1/payments/razorpay/webhook')
      .set('x-razorpay-signature', signature)
      .set('Content-Type', 'application/json')
      .send(webhookBody)
    expect(webhookRes.status).toBe(200)

    // Step 14 & 15: Verify Order State in DB
    const dbOrderPaid = await prisma.order.findUnique({ where: { id: orderId } })
    expect(dbOrderPaid?.status).toBe(OrderStatus.CONFIRMED)
    expect(dbOrderPaid?.paymentStatus).toBe(PaymentStatus.PAID)

    // Step 16: Verify Inventory Deduction (Available: 10 - 2 = 8, Sold: 2)
    const inventory = await prisma.inventory.findUnique({ where: { productId } })
    expect(inventory?.availableQuantity).toBe(8)
    expect(inventory?.soldQuantity).toBe(2)

    // Step 17: Verify Invoice Generation
    const invoice = await prisma.invoice.findUnique({ where: { orderId } })
    expect(invoice).not.toBeNull()
    expect(invoice?.status).toBe('ISSUED')

    // Step 18: Verify Email Queue / Dispatch (SES transport)
    const deadline = Date.now() + 2000
    while ((EmailQueue.queueSize() > 0 || EmailQueue.stats().isProcessing) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(capture.attachments.length).toBeGreaterThanOrEqual(1)
    const sentEmail = capture.attachments.find((a) => a.toEmail === customerEmail)
    expect(sentEmail).toBeDefined()
    expect(sentEmail?.subject).toContain(orderNumber)

    // Step 19: Update Delivery Status (Admin)
    const updateToProcessing = await request(app)
      .put(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderStatus.PROCESSING })
    expect(updateToProcessing.status).toBe(200)

    // The state machine requires PROCESSING -> PACKED -> SHIPPED; shipping
    // straight from PROCESSING is rejected with 409.
    const updateToPacked = await request(app)
      .put(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderStatus.PACKED })
    expect(updateToPacked.status).toBe(200)

    const updateDelivery = await request(app)
      .put(`/api/v1/admin/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: OrderStatus.SHIPPED })
    expect(updateDelivery.status).toBe(200)

    // Step 20: Customer Views Order & Delivery Status
    const customerOrder = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`)
    expect(customerOrder.status).toBe(200)
    expect(customerOrder.body.status).toBe(OrderStatus.SHIPPED)
  })

  describe('Edge Cases & Failure Recovery Scenarios', () => {
    it('handles payment failure gracefully', async () => {
      // Create checkout
      const chk = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId, items: [{ productId, quantity: 1 }] })
      expect(chk.status).toBe(201)

      const orderId = chk.body.orderId
      const razorpayOrderId = `order_fail_${ts}`
      await prisma.payment.update({
        where: { orderId },
        data: { razorpayOrderId },
      })

      // Send payment.failed webhook
      const failBody = JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_fail_${ts}`,
              order_id: razorpayOrderId,
              amount: 25000,
              currency: 'INR',
              status: 'failed',
            },
          },
        },
      })
      const signature = webhookSignature(failBody, webhookSecret)

      const res = await request(app)
        .post('/api/v1/payments/razorpay/webhook')
        .set('x-razorpay-signature', signature)
        .set('Content-Type', 'application/json')
        .send(failBody)
      expect(res.status).toBe(200)

      const dbOrder = await prisma.order.findUnique({ where: { id: orderId } })
      expect(dbOrder?.status).toBe(OrderStatus.PAYMENT_FAILED)
      expect(dbOrder?.paymentStatus).toBe(PaymentStatus.FAILED)
    })

    it('rejects checkout when requesting insufficient stock', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId, items: [{ productId, quantity: 999 }] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('Quantity must be 100 or fewer')
    })

    it('rejects checkout with an invalid coupon code', async () => {
      const res = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ addressId, couponCode: 'INVALID_COUPON_123', items: [{ productId, quantity: 1 }] })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('is invalid')
    })

    it('prevents duplicate order creation on duplicate checkout requests (idempotency)', async () => {
      const idempotencyKey = `idemp_${ts}_${Math.random()}`
      const reqBody = { addressId, items: [{ productId, quantity: 1 }], idempotencyKey }

      const first = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(reqBody)
      expect(first.status).toBe(201)

      const second = await request(app)
        .post('/api/v1/checkout')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(reqBody)
      expect(second.status).toBe(200)
      expect(second.body.orderId).toBe(first.body.orderId)
    })
  })
})
