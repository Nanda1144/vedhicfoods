import './_safety'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { EmailService, EmailQueue, __setEmailRetryDelayForTests } from '../../src/services/email.service'
import { OrderEmailService } from '../../src/services/order-email.service'
import { InvoiceEmailService } from '../../src/services/invoice-email.service'
import { RazorpayService } from '../../src/integrations/razorpay/razorpay.service'
import {
  razorpayClient,
  clearRazorpayCredentialCache,
} from '../../src/integrations/razorpay/razorpay.client'
import { emailTransport } from '../../src/integrations/email/email-transport'
import { env } from '../../src/config/env'
import type { InvoiceData } from '../../src/integrations/pdf/invoice-generator'
import { captureEmailTransport, type EmailTransportCapture } from './helpers/email-capture'

const app = createApp()

/**
 * End-to-end transactional email coverage.
 *
 * Every notification is captured at the `emailTransport` boundary, which is the
 * single seam shared by the auth service, checkout, the order lifecycle
 * notifier, invoices and support notifications. That makes it possible to prove
 * *what the application decided to send* — recipient, subject, rendered body,
 * attachment — for all eleven notification types without depending on Brevo or
 * SES.
 *
 * This suite also pins the two behavioural guarantees that matter most:
 *  1. a mail outage must never roll back a state transition (decoupling), and
 *  2. a logical event must never be delivered twice (idempotency).
 */
describe('Transactional email delivery — all notification types', () => {
  let adminToken: string
  let customerToken: string
  let customerId: string
  let customerEmail: string
  let addressId: string
  let categoryId: string
  let productId: string

  const ts = Date.now()
  let cap: EmailTransportCapture | undefined

  async function createOrder(paymentMethod = 'COD', qty = 1) {
    const res = await request(app)
      .post('/api/v1/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ addressId, items: [{ productId, quantity: qty }], paymentMethod })
    if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`)
    const order = await prisma.order.findUnique({ where: { orderNumber: res.body.orderNumber } })
    return { orderId: order!.id, orderNumber: order!.orderNumber, order: order! }
  }

  /** Promotes a COD order to a paid Razorpay one with a CAPTURED payment row. */
  async function createPaidOrder() {
    const { orderId, orderNumber, order } = await createOrder()
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED', paymentStatus: 'PAID' },
    })
    // Checkout already provisions a payment row for every order, so promote it
    // in place rather than inserting a second one (orderId is unique).
    const gatewayFields = {
      status: 'CAPTURED' as const,
      method: 'RAZORPAY' as const,
      razorpayOrderId: `order_test_${ts}_${Math.random().toString(36).slice(2, 8)}`,
      razorpayPaymentId: `pay_test_${ts}_${Math.random().toString(36).slice(2, 8)}`,
      verifiedAt: new Date(),
    }
    await prisma.payment.upsert({
      where: { orderId },
      update: gatewayFields,
      create: { orderId, amount: order.total, ...gatewayFields },
    })
    return { orderId, orderNumber }
  }

  let createdOrderIds: string[] = []

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken

    customerEmail = `email.delivery.${ts}@vedhicfoods.com`
    const reg = await AuthService.register({
      fullName: 'Email Delivery Customer',
      email: customerEmail,
      password: 'EmailDelivery@Vedhic2026!',
    })
    customerToken = reg.accessToken
    customerId = reg.user.id

    const catRes = await request(app)
      .post('/api/v1/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Email Delivery Category ${ts}`, slug: `email-delivery-cat-${ts}` })
    categoryId = catRes.body.id || catRes.body.category?.id || catRes.body.data?.id

    const prodRes = await request(app)
      .post('/api/v1/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `Email Delivery Product ${ts}`,
        slug: `email-delivery-prod-${ts}`,
        sku: `SKU-EMAIL-${ts}`,
        categoryId,
        price: 450,
        mrp: 500,
        stock: 40,
      })
    productId = prodRes.body.id || prodRes.body.product?.id || prodRes.body.data?.id

    const addrRes = await request(app)
      .post('/api/v1/customer/addresses')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        fullName: 'Email Delivery Customer',
        phone: '9876512345',
        line1: '7 Mail Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      })
    addressId = addrRes.body.data.id

    // Ensure the refund path uses the env-fallback client we spy on, not a
    // DB-configured client left behind by a payment-settings suite.
    await prisma.paymentSettings.deleteMany({ where: { id: 'default' } }).catch(() => {})
    clearRazorpayCredentialCache()
  }, 120000)

  afterAll(async () => {
    await prisma.deliveryHistory.deleteMany({ where: { delivery: { order: { userId: customerId } } } }).catch(() => {})
    await prisma.delivery.deleteMany({ where: { order: { userId: customerId } } }).catch(() => {})
    await prisma.couponUsage.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.inventoryLog.deleteMany({ where: { productId } }).catch(() => {})
    await prisma.orderItem.deleteMany({ where: { order: { userId: customerId } } }).catch(() => {})
    await prisma.payment.deleteMany({ where: { order: { userId: customerId } } }).catch(() => {})
    await prisma.invoice.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.order.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.cartItem.deleteMany({ where: { productId } }).catch(() => {})
    await prisma.inventory.deleteMany({ where: { productId } }).catch(() => {})
    await prisma.address.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.product.deleteMany({ where: { id: productId } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: categoryId } }).catch(() => {})
    await prisma.passwordResetToken.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.userRole.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorId: customerId } }).catch(() => {})
    await prisma.refreshToken.deleteMany({ where: { userId: customerId } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: customerId } }).catch(() => {})
  }, 120000)

  beforeEach(() => {
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
    __setEmailRetryDelayForTests(1)
    cap = captureEmailTransport()
  })

  afterEach(() => {
    cap?.restore()
    cap = undefined
    vi.restoreAllMocks()
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
  })

  // 1 — registration / welcome
  it('1. registration sends a verification email (with link) and a welcome email', async () => {
    const email = `email.delivery.new.${ts}@vedhicfoods.com`
    const reg = await AuthService.register({
      fullName: 'New Registrant',
      email,
      password: 'NewRegistrant@Vedhic2026!',
    })
    await prisma.user.deleteMany({ where: { id: reg.user.id } }).catch(() => {})

    const sent = cap!.to(email)
    expect(sent).toHaveLength(2)

    const verify = sent.find((e) => e.subject.includes('Verify your email'))
    expect(verify).toBeDefined()
    expect(verify!.htmlContent).toContain('/verify-email?token=')
    expect(verify!.htmlContent).toContain(reg.verificationToken as string)

    const welcome = sent.find((e) => e.subject === 'Welcome to Vedhic Foods')
    expect(welcome).toBeDefined()
    expect(welcome!.htmlContent).toContain('New Registrant')
  })

  // 2 — password reset
  it('2. forgot-password sends a reset email containing a usable link', async () => {
    const { resetToken } = await AuthService.requestPasswordReset(customerEmail)

    const sent = cap!.to(customerEmail).find((e) => e.subject.includes('Password Reset'))
    expect(sent).toBeDefined()
    expect(sent!.htmlContent).toContain('/reset-password?token=')
    expect(sent!.htmlContent).toContain(resetToken as string)
  })

  // 3 — order confirmation
  it('3. checkout sends an order-confirmation email with order number, item and total', async () => {
    const { orderNumber } = await createOrder()

    const sent = cap!
      .to(customerEmail)
      .find((e) => e.subject === `Order Confirmed: ${orderNumber} - Vedhic Foods`)
    expect(sent).toBeDefined()
    expect(sent!.htmlContent).toContain(orderNumber)
    expect(sent!.htmlContent).toContain(`Email Delivery Product ${ts}`)
    expect(sent!.textContent).toContain(orderNumber)
  })

  // 4 — payment confirmation (customer) + admin notification
  it('4. a captured payment emails the customer and alerts the admin inbox', async () => {
    const { orderId, orderNumber } = await createPaidOrder()

    await OrderEmailService.paymentConfirmed(orderId)
    await OrderEmailService.notifyAdminPaidOrder(orderId)

    const customerMail = cap!
      .to(customerEmail)
      .find((e) => e.subject === `Payment Confirmed: ${orderNumber} - Vedhic Foods`)
    expect(customerMail).toBeDefined()
    expect(customerMail!.htmlContent).toContain(orderNumber)

    const adminMail = cap!
      .to(EmailService.adminRecipient())
      .find((e) => e.subject === `Admin Alert: ${orderNumber} - Vedhic Foods`)
    expect(adminMail).toBeDefined()
    expect(adminMail!.htmlContent).toContain(orderNumber)
  })

  // 5 — payment failure
  it('5. marking a payment failed sends a failure notice with the reason', async () => {
    const { orderId } = await createOrder()

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/fail-payment`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Card declined by issuer' })
    expect(res.status).toBe(200)

    const sent = cap!.to(customerEmail).find((e) => e.subject.startsWith('Payment Failed:'))
    expect(sent).toBeDefined()
    expect(sent!.htmlContent).toContain('Card declined by issuer')
  })

  // 6 — cancellation
  it('6. cancelling an order sends a cancellation notice with the reason', async () => {
    const { orderId } = await createOrder()

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ reason: 'Ordered by mistake' })
    expect(res.status).toBe(200)

    const sent = cap!.to(customerEmail).find((e) => e.subject.startsWith('Order Cancelled:'))
    expect(sent).toBeDefined()
    expect(sent!.htmlContent).toContain('Ordered by mistake')
  })

  // 7 — invoice attachment (customer + admin copies)
  it('7. invoice emails attach a PDF and address the admin copy to the ops inbox', async () => {
    const invoiceData: InvoiceData = {
      invoiceNumber: `VF-TEST-${ts}`,
      orderNumber: `VF-ORD-${ts}`,
      orderDate: new Date().toISOString(),
      customerName: 'Email Delivery Customer',
      customerEmail,
      shippingAddress: {
        fullName: 'Email Delivery Customer',
        line1: '7 Mail Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      items: [{ name: 'Millet Laddu', price: 450, quantity: 1, subtotal: 450 }],
      subtotal: 450,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 450,
      paymentMethod: 'razorpay',
      paymentStatus: 'PAID',
    }

    await InvoiceEmailService.sendOrderConfirmedInvoiceEmail(invoiceData)
    const pdfBuffer = await (await import('../../src/integrations/pdf/invoice-generator')).InvoiceGenerator.generateA4Pdf(invoiceData)
    await InvoiceEmailService.sendAdminInvoiceEmail(invoiceData, pdfBuffer)

    expect(cap!.attachments).toHaveLength(2)
    const customerAttachment = cap!.attachments.find((a) => a.toEmail === customerEmail)
    expect(customerAttachment).toBeDefined()
    expect(customerAttachment!.attachment.name).toBe(`Invoice-VF-ORD-${ts}.pdf`)
    // PDF magic bytes (%PDF) survive base64 encoding at position 0.
    expect(Buffer.from(customerAttachment!.attachment.content, 'base64').subarray(0, 4).toString()).toBe('%PDF')

    const adminAttachment = cap!.attachments.find((a) => a.toEmail === EmailService.adminRecipient())
    expect(adminAttachment).toBeDefined()
  })

  // 8 — delivery lifecycle updates
  it('8. delivery transitions send shipped, out-for-delivery and delivered emails', async () => {
    const { orderId, orderNumber } = await createOrder()

    await OrderEmailService.deliveryUpdate(orderId, 'shipped')
    await OrderEmailService.deliveryUpdate(orderId, 'out_for_delivery')
    await OrderEmailService.deliveryUpdate(orderId, 'delivered')

    expect(cap!.to(customerEmail).some((e) => e.subject === `Order Shipped: ${orderNumber} - Vedhic Foods`)).toBe(true)
    expect(cap!.to(customerEmail).some((e) => e.subject === `Out for Delivery: ${orderNumber} - Vedhic Foods`)).toBe(true)
    expect(cap!.to(customerEmail).some((e) => e.subject === `Delivered: ${orderNumber} - Vedhic Foods`)).toBe(true)
  })

  // 9 — refund
  it('9. a gateway refund updates payment state and emails the customer', async () => {
    const { orderId, orderNumber } = await createPaidOrder()
    const gatewayRefund = vi
      .spyOn(razorpayClient.payments as any, 'refund')
      .mockResolvedValue({ id: `rfnd_test_${ts}`, status: 'processed' })

    const result = await RazorpayService.refundPayment({ orderId, reason: 'Customer request' })
    expect(gatewayRefund).toHaveBeenCalledTimes(1)

    const sent = cap!.to(customerEmail).find((e) => e.subject === `Refund Processed: ${orderNumber} - Vedhic Foods`)
    expect(sent).toBeDefined()
    expect(sent!.htmlContent).toContain(result.refundId)

    const payment = await prisma.payment.findUnique({ where: { orderId } })
    expect(payment!.status).toBe('REFUNDED')
    const order = await prisma.order.findUnique({ where: { id: orderId } })
    expect(order!.paymentStatus).toBe('REFUNDED')
  })

  // 10 — idempotency
  it('10. a repeated lifecycle dispatch is delivered only once', async () => {
    const { orderId } = await createPaidOrder()

    await OrderEmailService.paymentConfirmed(orderId, 'pay-once')
    await OrderEmailService.paymentConfirmed(orderId, 'pay-once')

    const paymentMails = cap!
      .to(customerEmail)
      .filter((e) => e.subject.startsWith('Payment Confirmed:'))
    expect(paymentMails).toHaveLength(1)
  })

  // 11 — decoupling: mail failure must not corrupt state
  it('11. a transport outage does not roll back the refund', async () => {
    const { orderId } = await createPaidOrder()
    vi.spyOn(razorpayClient.payments as any, 'refund').mockResolvedValue({ id: `rfnd_outage_${ts}`, status: 'processed' })
    // Force the outbound send to fail after the queue exhausts its retries.
    vi.spyOn(emailTransport, 'sendTransactionalEmail').mockRejectedValue(new Error('SES unavailable'))

    await expect(RazorpayService.refundPayment({ orderId, reason: 'Outage test' })).resolves.toBeDefined()

    const payment = await prisma.payment.findUnique({ where: { orderId } })
    expect(payment!.status).toBe('REFUNDED')
  })

  // 12 — security: no provider secrets leak into customer mail
  it('12. rendered emails never contain provider credentials', async () => {
    const { orderId } = await createPaidOrder()
    await OrderEmailService.paymentConfirmed(orderId)

    const secrets = [
      env.BREVO_API_KEY,
      env.AWS_SECRET_ACCESS_KEY,
      env.RAZORPAY_KEY_SECRET,
      env.SES_SENDER_EMAIL,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0)

    const corpus = cap!.emails.map((e) => `${e.subject}\n${e.htmlContent}\n${e.textContent ?? ''}`).join('\n')
    expect(corpus).not.toContain('xkeysib')
    for (const secret of secrets) {
      expect(corpus).not.toContain(secret)
    }
  })
})
