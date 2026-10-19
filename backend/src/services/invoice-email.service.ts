import { InvoiceData, InvoiceGenerator } from '../integrations/pdf/invoice-generator'
import { logger } from '../config/logger'
import { EmailQueue, EmailService } from './email.service'

/**
 * Invoice email dispatch.
 *
 * Extracted from the Brevo integration so the transport is chosen by
 * `EMAIL_PROVIDER` like every other email: previously these two methods called
 * Brevo directly, so switching production to SES silently dropped the invoice
 * (the SES provider also discarded attachments). Both now go through
 * `EmailQueue`, whose attachment path uses SES `SendRawEmail` on AWS.
 *
 * Going through the queue - rather than calling the transport directly - gives
 * invoice mail the same retry, backoff and bounce/complaint suppression as every
 * other transactional email, and the `dedupeKey` collapses the two code paths
 * that can fire for one order (checkout, then payment confirmation) into a single
 * send.
 */
export class InvoiceEmailService {
  private static customerHtml(data: InvoiceData): string {
    return `
      <div style="font-family: Arial, sans-serif; color: #2C2214; max-width: 600px; margin: 0 auto; border: 1px solid #E8E1D5; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #2C2214; padding: 24px; text-align: center;">
          <h1 style="color: #C9A24B; margin: 0; font-size: 24px;">VEDHIC FOODS</h1>
          <p style="color: #E8E1D5; margin: 4px 0 0 0; font-size: 13px;">Pure Farm-Fresh Millets &amp; Heritage Organic Laddus</p>
        </div>
        <div style="padding: 24px;">
          <h2 style="color: #2C2214; margin-top: 0;">Namaste ${data.customerName},</h2>
          <p>Your order <strong>${data.orderNumber}</strong> has been successfully confirmed!</p>
          <p>Invoice No: <strong>${data.invoiceNumber}</strong></p>
          <p>We are handcrafting and packaging your organic foods with natural ingredients and pure cold-pressed A2 ghee.</p>

          <div style="background-color: #F8F5F0; padding: 16px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Order Summary:</strong></p>
            <p style="margin: 4px 0;">Total Amount: <strong>Rs.${data.total.toFixed(2)}</strong></p>
            <p style="margin: 4px 0;">Payment Method: <strong>${data.paymentMethod.toUpperCase()}</strong></p>
            <p style="margin: 4px 0;">Delivery Address: ${data.shippingAddress.line1}, ${data.shippingAddress.city} - ${data.shippingAddress.pincode}</p>
          </div>

          <p style="color: #6B4A2F;"><strong>Your official A4 Tax Invoice PDF is attached to this email for your records.</strong></p>

          <p style="font-size: 13px; color: #766B57; margin-top: 30px;">
            Need help? Contact our care team at <a href="mailto:care@vedhicfoods.com" style="color: #9E7428;">care@vedhicfoods.com</a> or +91 98765 43210.
          </p>
        </div>
        <div style="background-color: #FCFAF7; padding: 16px; text-align: center; border-top: 1px solid #E8E1D5; font-size: 12px; color: #766B57;">
          &copy; ${new Date().getFullYear()} Vedhic Foods. Traditional Indian Heritage Foods.
        </div>
      </div>
    `
  }

  private static adminHtml(data: InvoiceData): string {
    return `
      <div style="font-family: Arial, sans-serif; color: #2C2214; max-width: 600px; margin: 0 auto; border: 1px solid #E8E1D5; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #2C2214; padding: 20px; text-align: center;">
          <h1 style="color: #C9A24B; margin: 0; font-size: 22px;">VEDHIC FOODS — ADMIN COPY</h1>
          <p style="color: #E8E1D5; margin: 4px 0 0 0; font-size: 12px;">Printable Tax Invoice</p>
        </div>
        <div style="padding: 24px;">
          <h2 style="color: #2C2214; margin-top: 0;">Paid order confirmed</h2>
          <p>The following order has been paid and invoiced. The A4 tax invoice is attached for printing and filing.</p>
          <div style="background-color: #F8F5F0; padding: 16px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Invoice No:</strong> ${data.invoiceNumber}</p>
            <p style="margin: 4px 0;"><strong>Order No:</strong> ${data.orderNumber}</p>
            <p style="margin: 4px 0;"><strong>Order Date:</strong> ${data.orderDate}</p>
            <p style="margin: 4px 0;"><strong>Customer:</strong> ${data.customerName} (${data.customerEmail})</p>
            <p style="margin: 4px 0;"><strong>Payment Method:</strong> ${String(data.paymentMethod).toUpperCase()}</p>
            <p style="margin: 4px 0;"><strong>Payment Status:</strong> ${data.paymentStatus}</p>
            <p style="margin: 4px 0;"><strong>Total:</strong> Rs.${data.total.toFixed(2)}</p>
            <p style="margin: 4px 0;"><strong>Ship To:</strong> ${data.shippingAddress.line1}, ${data.shippingAddress.city} - ${data.shippingAddress.pincode}</p>
          </div>
          <p style="color: #6B4A2F;"><strong>Printable A4 tax invoice attached.</strong></p>
        </div>
      </div>
    `
  }

  /** Customer copy — official A4 tax invoice as a PDF attachment. Best-effort. */
  public static async sendOrderConfirmedInvoiceEmail(data: InvoiceData): Promise<boolean> {
    try {
      const pdfBuffer = await InvoiceGenerator.generateA4Pdf(data)
      await EmailQueue.enqueue({
        to: data.customerEmail,
        toName: data.customerName,
        subject: `Order Confirmed: ${data.orderNumber} - Vedhic Foods Tax Invoice`,
        htmlBody: InvoiceEmailService.customerHtml(data),
        templateName: 'invoice_customer',
        variables: {
          customerEmail: data.customerEmail,
          customerName: data.customerName,
          orderNumber: data.orderNumber,
          invoiceNumber: data.invoiceNumber,
        },
        dedupeKey: `invoice:customer:${data.invoiceNumber || data.orderNumber}`,
        attachment: {
          name: `Invoice-${data.orderNumber}.pdf`,
          content: pdfBuffer.toString('base64'),
        },
      })
      return true
    } catch (error: any) {
      logger.error({ error: error?.message, orderNumber: data.orderNumber }, 'Failed to queue customer invoice email')
      return false
    }
  }

  /**
   * Admin copy — printable tax invoice. Reuses the already-generated PDF buffer
   * so the order is never re-rendered.
   */
  public static async sendAdminInvoiceEmail(data: InvoiceData, pdfBuffer: Buffer): Promise<boolean> {
    try {
      await EmailQueue.enqueue({
        to: EmailService.adminRecipient(),
        toName: 'Vedhic Foods Admin',
        subject: `[Admin Copy] Paid Order ${data.orderNumber} — Invoice ${data.invoiceNumber}`,
        htmlBody: InvoiceEmailService.adminHtml(data),
        templateName: 'invoice_admin',
        variables: {
          customerEmail: data.customerEmail,
          customerName: data.customerName,
          orderNumber: data.orderNumber,
          invoiceNumber: data.invoiceNumber,
        },
        dedupeKey: `invoice:admin:${data.invoiceNumber || data.orderNumber}`,
        attachment: {
          name: `Invoice-${data.orderNumber}.pdf`,
          content: pdfBuffer.toString('base64'),
        },
      })
      return true
    } catch (error: any) {
      logger.error({ error: error?.message, orderNumber: data.orderNumber }, 'Failed to queue admin invoice email')
      return false
    }
  }
}
