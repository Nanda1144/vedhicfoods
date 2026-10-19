import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvoiceEmailService } from '../../src/services/invoice-email.service'
import { EmailQueue, EmailService } from '../../src/services/email.service'
import { EmailSuppressionService } from '../../src/integrations/email/email-suppression.service'
import { captureEmailTransport, type EmailTransportCapture } from '../integration/helpers/email-capture'
import type { InvoiceData } from '../../src/integrations/pdf/invoice-generator'
import { inspectPdf } from '../integration/helpers/pdf-inspect'

const invoiceData: InvoiceData = {
  invoiceNumber: 'INV-2026-000888',
  orderNumber: 'VF-2026-000999',
  orderDate: '2026-10-18',
  customerName: 'Ananya Iyer',
  customerEmail: 'ananya@example.com',
  customerPhone: '9876501234',
  shippingAddress: {
    fullName: 'Ananya Iyer',
    line1: '42 Mango Grove Layout',
    line2: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
    country: 'India',
  },
  items: [{ name: 'Organic Little Millet', sku: 'SKU-MILLET-01', unit: '500g', price: 250, quantity: 2, subtotal: 500 }],
  subtotal: 500,
  discount: 25,
  shipping: 49,
  tax: 23.75,
  total: 547.75,
  paymentMethod: 'RAZORPAY',
  paymentStatus: 'PAID',
}

describe('invoice email PDF attachments', () => {
  let capture: EmailTransportCapture | undefined

  beforeEach(() => {
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
    EmailSuppressionService.__seedForTests({})
    capture = captureEmailTransport()
  })

  afterEach(() => {
    capture?.restore()
    capture = undefined
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
    EmailSuppressionService.__resetCacheForTests()
  })

  it('sends a readable customer invoice PDF with the matching recipient and order details', async () => {
    await InvoiceEmailService.sendOrderConfirmedInvoiceEmail(invoiceData)

    const deadline = Date.now() + 2000
    while ((EmailQueue.queueSize() > 0 || EmailQueue.stats().isProcessing) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(capture!.attachments).toHaveLength(1)
    const sent = capture!.attachments[0]!
    expect(sent.toEmail).toBe(invoiceData.customerEmail)
    expect(sent.subject).toContain(invoiceData.orderNumber)
    expect(sent.htmlContent).toContain('VEDHIC FOODS')
    expect(sent.htmlContent).toContain(invoiceData.invoiceNumber)
    expect(sent.htmlContent).toContain(invoiceData.orderNumber)
    expect(sent.attachment.name).toBe(`Invoice-${invoiceData.orderNumber}.pdf`)
    const pdf = Buffer.from(sent.attachment.content, 'base64')
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const inspected = inspectPdf(pdf)
    expect(inspected.allText).toContain(invoiceData.invoiceNumber)
    expect(inspected.allText).toContain('Organic Little Millet')
  })

  it('sends the matching PDF to the operations inbox for the admin copy', async () => {
    const { InvoiceGenerator } = await import('../../src/integrations/pdf/invoice-generator')
    const pdf = await InvoiceGenerator.generateA4Pdf(invoiceData)
    await InvoiceEmailService.sendAdminInvoiceEmail(invoiceData, pdf)

    const deadline = Date.now() + 2000
    while ((EmailQueue.queueSize() > 0 || EmailQueue.stats().isProcessing) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(capture!.attachments).toHaveLength(1)
    const sent = capture!.attachments[0]!
    expect(sent.toEmail).toBe(EmailService.adminRecipient())
    expect(sent.subject).toContain(invoiceData.invoiceNumber)
    expect(sent.attachment.name).toBe(`Invoice-${invoiceData.orderNumber}.pdf`)
    expect(Buffer.from(sent.attachment.content, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
