import type { Invoice } from '@/types'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { SITE } from '@/config/site'
import { mockRequest, type RequestOptions } from './http'

interface InvoiceEmailPayload {
  to: string
  subject: string
  body: string
  mailtoHref: string
}

function renderInvoiceBody(invoice: Invoice): string {
  const rows = invoice.items
    .map((item) => `• ${item.name} (${item.unit}) × ${item.quantity} = ${formatCurrency(item.price * item.quantity)}`)
    .join('\n')

  return [
    `Dear ${invoice.customerName},`,
    ``,
    `Thank you for your order${invoice.orderNumber ? ` ${invoice.orderNumber}` : ''}. Your tax invoice is attached / available below.`,
    ``,
    `Invoice ${invoice.invoiceNumber} · issued ${formatDateTime(invoice.issuedAt)}`,
    ``,
    rows,
    ``,
    `Subtotal: ${formatCurrency(invoice.subtotal)}`,
    `Shipping: ${invoice.shipping === 0 ? 'Free' : formatCurrency(invoice.shipping)}`,
    invoice.discount > 0 ? `Coupon: − ${formatCurrency(invoice.discount)}` : null,
    invoice.tax > 0 ? `GST: ${formatCurrency(invoice.tax)}` : null,
    `Total: ${formatCurrency(invoice.total)}`,
    ``,
    `Questions? Reply to this email or visit ${SITE.brandName}.`,
    ``,
    `— ${SITE.brandName} · ${SITE.tagline}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** Build a prefilled `mailto:` the customer can review and send from their own client. */
export function invoiceEmailFor(invoice: Invoice): InvoiceEmailPayload {
  const subject = `Your ${SITE.brandName} invoice ${invoice.invoiceNumber}`
  return {
    to: invoice.customerEmail,
    subject,
    body: renderInvoiceBody(invoice),
    mailtoHref: `mailto:${encodeURIComponent(invoice.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(renderInvoiceBody(invoice))}`,
  }
}

/**
 * Simulates emailing the invoice to the customer after a successful payment.
 * In production this calls a transactional-email provider (e.g. AWS SES /
 * Resend / Postmark) with the rendered invoice as an attachment.
 */
export const invoiceEmailService = {
  async send(invoice: Invoice, options?: RequestOptions): Promise<{ to: string; sentAt: string }> {
    const payload = invoiceEmailFor(invoice)
    return mockRequest(
      () => ({
        to: payload.to,
        sentAt: new Date().toISOString(),
      }),
      { delay: 700, ...options },
    )
  },
}
