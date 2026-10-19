/**
 * Automatic Invoice Generation — workflow & PDF integration suite.
 *
 * Exercises the invoice subsystem end-to-end against a real database:
 *   - automatic generation for a paid order (numbering, snapshots, S3 key)
 *   - refusal to invoice unpaid / failed / cancelled orders
 *   - idempotency (duplicate confirmation → one invoice)
 *   - regeneration (admin), download (customer + admin), retrieval, listing
 *   - ownership enforcement (customer B cannot see customer A's invoice)
 *   - historical immutability (a later product price change does not rewrite an
 *     issued invoice or its regenerated PDF)
 *   - S3 storage integration (key layout, content type, metadata, presigned URL)
 *
 * The generated A4 PDF is parsed back with a dependency-free extractor
 * (helpers/pdf-inspect) so the rendered text is asserted, not just the JSON.
 */

import './_safety'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { InvoiceService } from '../../src/services/invoice.service'
import { S3Service } from '../../src/integrations/aws/s3/s3.service'
import { inspectPdf } from './helpers/pdf-inspect'
import { InvoiceStatus, OrderStatus, PaymentStatus } from '@prisma/client'

const app = createApp()
const ts = Date.now()

let adminToken: string
let customerAToken: string
let customerAId: string
let customerAEmail: string
let customerBToken: string
let customerBId: string

const createdProductIds: string[] = []
const createdCategoryIds: string[] = []
let orderSeq = 0

interface OrderItemInput {
  productId?: string
  name: string
  sku: string
  unit: string
  price: number
  quantity: number
  subtotal: number
}

async function createOrder(
  userId: string,
  customerName: string,
  customerEmail: string,
  overrides: {
    paymentStatus?: PaymentStatus
    status?: OrderStatus
    items?: OrderItemInput[]
    discount?: number
    shipping?: number
    tax?: number
    paymentMethod?: string
  } = {}
) {
  const items: OrderItemInput[] = overrides.items ?? [
    { name: 'Organic Foxtail Millet', sku: 'SKU-FOX-01', unit: '1kg', price: 120, quantity: 2, subtotal: 240 },
    { name: 'Heritage Ghee Laddu', sku: 'SKU-LAD-01', unit: '250g', price: 260, quantity: 1, subtotal: 260 },
  ]
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
  const discount = overrides.discount ?? 50
  const shipping = overrides.shipping ?? 49
  const tax = overrides.tax ?? 25
  const total = subtotal - discount + shipping + tax
  orderSeq += 1

  return prisma.order.create({
    data: {
      orderNumber: `VF-${ts}-${String(orderSeq).padStart(4, '0')}`,
      userId,
      customerName,
      customerEmail,
      phone: '9876500000',
      subtotal,
      discount,
      shipping,
      tax,
      total,
      status: overrides.status ?? OrderStatus.CONFIRMED,
      paymentStatus: overrides.paymentStatus ?? PaymentStatus.PAID,
      paymentMethod: overrides.paymentMethod ?? 'RAZORPAY',
      currency: 'INR',
      shippingAddressSnapshot: {
        fullName: customerName,
        line1: 'No. 10, Invoice Layout',
        line2: 'MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India',
      },
      items: {
        create: items.map((item) => ({
          productId: item.productId ?? null,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal,
        })),
      },
    },
    include: { items: true },
  })
}

beforeAll(async () => {
  const admin = await AuthService.login({
    email: 'admin@vedhicfoods.com',
    password: 'Admin@Vedhic2026',
  })
  adminToken = admin.accessToken

  customerAEmail = `invoice.alice.${ts}@vedhictest.com`
  const regA = await AuthService.register({
    fullName: 'Alice Invoice',
    email: customerAEmail,
    password: 'AliceInvoice@Vedhic2026!',
  })
  customerAToken = regA.accessToken
  customerAId = regA.user.id

  const regB = await AuthService.register({
    fullName: 'Bob Invoice',
    email: `invoice.bob.${ts}@vedhictest.com`,
    password: 'BobInvoice@Vedhic2026!',
  })
  customerBToken = regB.accessToken
  customerBId = regB.user.id
})

afterAll(async () => {
  const userIds = [customerAId, customerBId]
  await prisma.invoice.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.deliveryHistory.deleteMany({ where: { delivery: { order: { userId: { in: userIds } } } } }).catch(() => {})
  await prisma.delivery.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.payment.deleteMany({ where: { order: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } }).catch(() => {})
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.inventoryLog.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
  await prisma.inventory.deleteMany({ where: { productId: { in: createdProductIds } } }).catch(() => {})
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {})
  await prisma.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } }).catch(() => {})
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {})
})

describe('InvoiceService.createInvoiceForOrder', () => {
  it('creates an ISSUED, PAID invoice with correct numbering, snapshot and S3 key', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)

    const invoice = await InvoiceService.createInvoiceForOrder(order.id)

    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/)
    expect(invoice.status).toBe(InvoiceStatus.ISSUED)
    expect(invoice.paymentStatus).toBe(PaymentStatus.PAID)
    expect(invoice.orderId).toBe(order.id)
    expect(invoice.userId).toBe(customerAId)

    // Amounts mirror the order snapshot exactly.
    expect(invoice.subtotal).toBeCloseTo(Number(order.subtotal), 2)
    expect(invoice.discount).toBeCloseTo(Number(order.discount), 2)
    expect(invoice.shipping).toBeCloseTo(Number(order.shipping), 2)
    expect(invoice.tax).toBeCloseTo(Number(order.tax), 2)
    expect(invoice.total).toBeCloseTo(Number(order.total), 2)

    // Storage layout + simulated (non-prod) URL.
    expect(invoice.s3PdfKey).toBe(`invoices/${customerAId}/${invoice.invoiceNumber}.pdf`)
    expect(invoice.pdfUrl).toContain(invoice.invoiceNumber)
    expect(invoice.pdfUrl).toMatch(/\.pdf$|\.pdf\?/)

    // Line items are snapshotted onto the invoice response.
    expect(invoice.order.items).toHaveLength(2)
    const first = invoice.order.items[0]!
    expect(first.price).toBe(120)
    expect(first.quantity).toBe(2)
    expect(first.subtotal).toBe(240)

    // Order moves to CONFIRMED.
    const orderDb = await prisma.order.findUnique({ where: { id: order.id } })
    expect(orderDb?.status).toBe(OrderStatus.CONFIRMED)
  })

  it('creates an ISSUED invoice for a confirmed, unpaid cash-on-delivery order', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail, {
      paymentStatus: PaymentStatus.PENDING,
      status: OrderStatus.CONFIRMED,
      paymentMethod: 'COD',
    })

    const invoice = await InvoiceService.createInvoiceForOrder(order.id)

    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/)
    expect(invoice.status).toBe(InvoiceStatus.ISSUED)
    expect(invoice.paymentStatus).toBe(PaymentStatus.PENDING)
    expect(invoice.order.paymentMethod).toBe('COD')
    expect(invoice.total).toBeCloseTo(Number(order.total), 2)

    const orderDb = await prisma.order.findUnique({ where: { id: order.id } })
    expect(orderDb?.invoiceId).toBe(invoice.id)
  })

  it('still refuses a cancelled cash-on-delivery order', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail, {
      paymentStatus: PaymentStatus.PENDING,
      status: OrderStatus.CANCELLED,
      paymentMethod: 'COD',
    })

    await expect(InvoiceService.createInvoiceForOrder(order.id)).rejects.toThrow(/paid orders/i)
    expect(await prisma.invoice.findUnique({ where: { orderId: order.id } })).toBeNull()
  })

  it('is idempotent — a duplicate confirmation yields a single invoice', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)

    const first = await InvoiceService.createInvoiceForOrder(order.id)
    const second = await InvoiceService.createInvoiceForOrder(order.id)

    expect(second.id).toBe(first.id)
    expect(second.invoiceNumber).toBe(first.invoiceNumber)
    expect(await prisma.invoice.count({ where: { orderId: order.id } })).toBe(1)
  })

  const unpaidScenarios: Array<{ label: string; paymentStatus: PaymentStatus; status: OrderStatus }> = [
    { label: 'PENDING', paymentStatus: PaymentStatus.PENDING, status: OrderStatus.PENDING_PAYMENT },
    { label: 'FAILED', paymentStatus: PaymentStatus.FAILED, status: OrderStatus.PAYMENT_FAILED },
    { label: 'CANCELLED', paymentStatus: PaymentStatus.REFUNDED, status: OrderStatus.CANCELLED },
  ]

  for (const scenario of unpaidScenarios) {
    it(`refuses to invoice a ${scenario.label} order and writes nothing`, async () => {
      const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail, {
        paymentStatus: scenario.paymentStatus,
        status: scenario.status,
      })

      await expect(InvoiceService.createInvoiceForOrder(order.id)).rejects.toThrow(/paid orders/i)
      expect(await prisma.invoice.findUnique({ where: { orderId: order.id } })).toBeNull()
    })
  }

  it('rejects an unknown order id with 404', async () => {
    await expect(InvoiceService.createInvoiceForOrder('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('Invoice retrieval & ownership', () => {
  let invoiceId: string
  let orderId: string
  let invoiceNumber: string

  beforeAll(async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)
    orderId = order.id
    const invoice = await InvoiceService.createInvoiceForOrder(order.id)
    invoiceId = invoice.id
    invoiceNumber = invoice.invoiceNumber
  })

  it('serves the invoice to its owner and to an admin', async () => {
    const owner = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${customerAToken}`)
    expect(owner.status).toBe(200)
    expect(owner.body.data.invoiceNumber).toBe(invoiceNumber)

    const admin = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(admin.status).toBe(200)
    expect(admin.body.data.id).toBe(invoiceId)
  })

  it('forbids another customer from reading it (403)', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${customerBToken}`)
    expect(res.status).toBe(403)
  })

  it('requires authentication (401)', async () => {
    const res = await request(app).get(`/api/v1/invoices/${invoiceId}`)
    expect(res.status).toBe(401)
  })

  it('retrieves by order id for owner and admin', async () => {
    const owner = await request(app)
      .get(`/api/v1/invoices/order/${orderId}`)
      .set('Authorization', `Bearer ${customerAToken}`)
    expect(owner.status).toBe(200)
    expect(owner.body.data.orderId).toBe(orderId)

    const admin = await request(app)
      .get(`/api/v1/invoices/order/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(admin.status).toBe(200)
  })

  it('returns 404 for an order with no invoice', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail, {
      paymentStatus: PaymentStatus.PENDING,
      status: OrderStatus.PENDING_PAYMENT,
    })
    const res = await request(app)
      .get(`/api/v1/invoices/order/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })

  it('scopes a customer listing to their own invoices', async () => {
    const res = await request(app)
      .get('/api/v1/invoices?limit=100')
      .set('Authorization', `Bearer ${customerAToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    for (const invoice of res.body.data) {
      expect(invoice.userId).toBe(customerAId)
    }
  })

  it('lets an admin search across customers and clamps bad pagination', async () => {
    const search = await request(app)
      .get(`/api/v1/invoices?search=${encodeURIComponent(customerAEmail)}&limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(search.status).toBe(200)
    expect(search.body.data.length).toBeGreaterThan(0)
    for (const invoice of search.body.data) {
      expect(invoice.order.customerEmail).toBe(customerAEmail)
    }

    const huge = await request(app)
      .get('/api/v1/invoices?limit=1000000')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(huge.body.pagination.limit).toBeLessThanOrEqual(100)

    const nan = await request(app)
      .get('/api/v1/invoices?limit=abc')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(nan.body.pagination.limit).toBe(20)
  })
})

describe('Invoice download', () => {
  let invoiceId: string
  let invoiceNumber: string

  beforeAll(async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)
    const invoice = await InvoiceService.createInvoiceForOrder(order.id)
    invoiceId = invoice.id
    invoiceNumber = invoice.invoiceNumber
  })

  it('returns a presigned download URL to the owner with correct filename/expiry', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/download`)
      .set('Authorization', `Bearer ${customerAToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.downloadUrl).toContain(invoiceNumber)
    expect(res.body.data.filename).toBe(`${invoiceNumber}.pdf`)
    expect(res.body.data.expiresIn).toBe(3600)
  })

  it('lets an admin download a customer invoice', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/download`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.downloadUrl).toBeTruthy()
  })

  it('forbids another customer from downloading (403)', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}/download`)
      .set('Authorization', `Bearer ${customerBToken}`)
    expect(res.status).toBe(403)
  })

  it('returns 404 for a missing invoice', async () => {
    const res = await request(app)
      .get('/api/v1/invoices/00000000-0000-0000-0000-000000000000/download')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(404)
  })
})

describe('Invoice regeneration & cancellation (admin)', () => {
  let invoiceId: string
  let invoiceS3Key: string

  beforeAll(async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)
    const invoice = await InvoiceService.createInvoiceForOrder(order.id)
    invoiceId = invoice.id
    invoiceS3Key = invoice.s3PdfKey!
  })

  it('regenerates the PDF for an admin, keeping the same object key', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/regenerate`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.s3PdfKey).toBe(invoiceS3Key)
    expect(res.body.data.pdfUrl).toBeTruthy()
  })

  it('forbids a customer from regenerating (403)', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/regenerate`)
      .set('Authorization', `Bearer ${customerAToken}`)
    expect(res.status).toBe(403)
  })

  it('cancels (voids) an invoice and rejects a missing reason or double-cancel', async () => {
    const missingReason = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
    expect(missingReason.status).toBe(400)

    const cancelled = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Duplicate charge reversed' })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe(InvoiceStatus.CANCELLED)

    const again = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Second attempt' })
    expect(again.status).toBe(400)
  })
})

describe('Historical immutability & S3 integration', () => {
  it('keeps the issued invoice and its regenerated PDF unchanged after a product price change', async () => {
    const category = await prisma.category.create({
      data: { name: `Invoice Immutability ${ts}`, slug: `invoice-immut-${ts}` },
    })
    createdCategoryIds.push(category.id)

    const product = await prisma.product.create({
      data: {
        name: `Historical Millet ${ts}`,
        slug: `historical-millet-${ts}`,
        sku: `HIST-${ts}`,
        price: 100,
        mrp: 130,
        stock: 50,
        unit: 'kg',
        categoryId: category.id,
        isActive: true,
        status: 'PUBLISHED',
        inventory: { create: { availableQuantity: 50, reservedQuantity: 0, soldQuantity: 0 } },
      },
    })
    createdProductIds.push(product.id)

    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail, {
      items: [
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unit: 'kg',
          price: 100,
          quantity: 2,
          subtotal: 200,
        },
      ],
      discount: 0,
      shipping: 49,
      tax: 10,
    })

    const invoice = await InvoiceService.createInvoiceForOrder(order.id)
    const originalTotal = invoice.total
    expect(invoice.order.items[0]!.price).toBe(100)

    // The catalogue price later changes. The invoice is a legal snapshot and
    // must not be rewritten.
    await prisma.product.update({ where: { id: product.id }, data: { price: 999 } })

    const reread = await InvoiceService.getInvoiceById(invoice.id)
    expect(reread!.order.items[0]!.price).toBe(100)
    expect(reread!.total).toBeCloseTo(originalTotal, 2)

    // Regenerated PDF still carries the original line price, not the new one.
    let captured: Buffer | undefined
    let capturedOptions: { key: string; contentType: string; metadata?: Record<string, string> } | undefined
    const originalUpload = S3Service.uploadDocument
    const uploadMock = vi.fn(async (options: any) => {
      captured = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)
      capturedOptions = options
      return `https://captured.test/${options.key}`
    })
    ;(S3Service as any).uploadDocument = uploadMock

    let regenerated
    try {
      regenerated = await InvoiceService.regenerateInvoicePdf(invoice.id)
    } finally {
      ;(S3Service as any).uploadDocument = originalUpload
    }

    expect(regenerated.s3PdfKey).toBe(`invoices/${customerAId}/${invoice.invoiceNumber}.pdf`)
    expect(capturedOptions).toBeDefined()
    expect(capturedOptions!.contentType).toBe('application/pdf')
    expect(capturedOptions!.metadata).toMatchObject({
      invoiceNumber: invoice.invoiceNumber,
      orderId: order.id,
      regenerated: 'true',
    })

    expect(captured).toBeDefined()
    const pdf = inspectPdf(captured!)
    const text = pdf.allText
    expect(text).toContain('Historical Millet')
    expect(text).toContain('Rs. 100.00')
    expect(text).toContain('Rs. 200.00')
    expect(text).not.toContain('Rs. 999.00')
    expect(text).toContain(`INV-`)
  })

  it('uploads the invoice PDF through S3Service with the server-side key and PDF metadata', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)

    let captured: Buffer | undefined
    let capturedOptions: { key: string; contentType: string; metadata?: Record<string, string> } | undefined
    const originalUpload = S3Service.uploadDocument
    const uploadMock = vi.fn(async (options: any) => {
      captured = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)
      capturedOptions = options
      return `https://${options.key}.s3.test`
    })
    ;(S3Service as any).uploadDocument = uploadMock

    let invoice
    try {
      invoice = await InvoiceService.createInvoiceForOrder(order.id)
    } finally {
      ;(S3Service as any).uploadDocument = originalUpload
    }

    expect(capturedOptions).toBeDefined()
    expect(capturedOptions!.key).toBe(`invoices/${customerAId}/${invoice!.invoiceNumber}.pdf`)
    expect(capturedOptions!.contentType).toBe('application/pdf')
    expect(capturedOptions!.metadata).toMatchObject({
      orderId: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: invoice!.invoiceNumber,
      customerEmail: customerAEmail,
    })

    expect(captured).toBeDefined()
    expect(captured!.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const pdf = inspectPdf(captured!)
    expect(pdf.imageXObjects).toBeGreaterThanOrEqual(1)
    expect(pdf.allText).toContain('VEDHIC FOODS')
    expect(pdf.allText).toContain(invoice!.invoiceNumber)
    expect(pdf.allText).toContain('GRAND TOTAL:')
    expect(pdf.allText).toContain('Alice Invoice')
  })

  it('generates a presigned (simulated in test) download URL from the stored key', async () => {
    const url = await S3Service.generatePresignedDownloadUrl('invoices/some-user/INV-2026-000001.pdf', 3600)
    expect(url).toContain('INV-2026-000001.pdf')
  })
})

describe('Daily invoice PDF', () => {
  it('combines every invoice issued on the business day into one PDF', async () => {
    const order = await createOrder(customerAId, 'Alice Invoice', customerAEmail)
    const invoice = await InvoiceService.createInvoiceForOrder(order.id)

    const result = await InvoiceService.getDailyInvoicesPdf(InvoiceService.todayBusinessDate())

    expect(result.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(result.count).toBeGreaterThanOrEqual(1)
    expect(result.filename).toMatch(/^invoices-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(inspectPdf(result.buffer).allText).toContain(invoice.invoiceNumber)
  })

  it('rejects an impossible calendar date', async () => {
    await expect(InvoiceService.getDailyInvoicesPdf('2026-02-31')).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})
