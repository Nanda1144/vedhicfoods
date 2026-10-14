import { getBranding } from '../services/email.service'

export interface TemplateVariables {
  customerEmail: string
  customerName: string
  orderNumber?: string
  orderId?: string
  invoiceId?: string
  invoiceNumber?: string
  paymentId?: string
  totalAmount?: number
  subtotal?: number
  discount?: number
  tax?: number
  shipping?: number
  paymentMethod?: string
  paymentStatus?: string
  orderDate?: string
  items?: Array<{
    name: string
    quantity: number
    price: number
    total?: number
  }>
  shippingAddress?: {
    fullName: string
    line1: string
    line2?: string
    city: string
    state: string
    pincode: string
    country: string
  }
  trackingNumber?: string
  carrier?: string
  deliveryDate?: string
  estimatedDelivery?: string
  resetToken?: string
  verificationToken?: string
  supportEmail?: string
  supportPhone?: string
  website?: string
  adminMessage?: string
  failureReason?: string
  cancellationReason?: string
  refundId?: string
  refundAmount?: number
  refundStatus?: string
  [key: string]: any
}

function formatCurrency(amount?: number): string {
  if (amount === undefined || amount === null) return '₹0.00'
  return `₹${Number(amount).toFixed(2)}`
}

/**
 * Encodes a value for safe placement inside HTML text or attribute context.
 *
 * SECURITY: templates interpolate customer-controlled data (order names,
 * shipping address fields, refund/cancellation reasons) into HTML email
 * bodies. Without this, a crafted `customerName` or address line could inject
 * markup — phishing links, form confusion, or a spoofed sender identity — into
 * transactional mail rendered by any client, and into the admin alert inbox.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(date?: string | Date): string {
  if (!date) return new Date().toLocaleDateString('en-IN')
  const d = new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function buildLayout(content: string, title: string): { html: string; text: string } {
  const branding = getBranding()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f5f1ec;
      font-family: Arial, Helvetica, sans-serif;
      color: #2C2214;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #2C5A3D 0%, #4A9D5C 100%);
      padding: 24px 32px;
      text-align: center;
    }
    .brand {
      color: #ffffff;
      font-size: 24px;
      font-weight: bold;
      margin: 0;
    }
    .tagline {
      color: #E4DAC4;
      font-size: 12px;
      margin-top: 8px;
    }
    .content {
      padding: 32px;
    }
    .footer {
      background-color: #f5f1ec;
      padding: 24px 32px;
      text-align: center;
      font-size: 12px;
      color: #766B57;
    }
    .button {
      display: inline-block;
      padding: 14px 28px;
      background-color: #2C5A3D;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      margin: 16px 0;
    }
    .info-box {
      background-color: #f9f7f2;
      border: 1px solid #E4DAC4;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .order-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .order-table th,
    .order-table td {
      border: 1px solid #E4DAC4;
      padding: 12px;
      text-align: left;
    }
    .order-table th {
      background-color: #f5f1ec;
    }
    .total-row {
      font-weight: bold;
      background-color: #f9f7f2;
    }
    .divider {
      border: 0;
      border-top: 1px solid #E4DAC4;
      margin: 24px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="brand">${branding.brandName}</h1>
      <p class="tagline">${branding.tagline}</p>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>${branding.brandName} &copy; ${new Date().getFullYear()}</p>
      <p>${branding.address}</p>
      <p>Support: ${branding.supportEmail} | ${branding.supportPhone}</p>
      <p><a href="${branding.website}">${branding.website}</a></p>
      ${branding.gstin ? `<p>GSTIN: ${branding.gstin}</p>` : ''}
    </div>
  </div>
</body>
</html>
  `

  const text = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { html, text }
}

function buildOrderSummary(vars: TemplateVariables): string {
  const itemsHtml = vars.items && vars.items.length > 0
    ? `
      <table class="order-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${vars.items
            .map(
              (item) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${item.quantity}</td>
              <td>${formatCurrency(item.price)}</td>
              <td>${formatCurrency(item.total || item.price * item.quantity)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `
    : ''

  const totalsHtml = `
    <div class="info-box">
      <p><strong>Order Number:</strong> ${escapeHtml(vars.orderNumber || 'N/A')}</p>
      <p><strong>Order Date:</strong> ${formatDate(vars.orderDate)}</p>
      ${vars.subtotal !== undefined ? `<p><strong>Subtotal:</strong> ${formatCurrency(vars.subtotal)}</p>` : ''}
      ${vars.discount !== undefined && vars.discount > 0 ? `<p><strong>Discount:</strong> -${formatCurrency(vars.discount)}</p>` : ''}
      ${vars.shipping !== undefined && vars.shipping > 0 ? `<p><strong>Shipping:</strong> ${formatCurrency(vars.shipping)}</p>` : ''}
      ${vars.tax !== undefined && vars.tax > 0 ? `<p><strong>Tax:</strong> ${formatCurrency(vars.tax)}</p>` : ''}
      <hr class="divider">
      <p style="font-size: 18px;"><strong>Total Amount:</strong> ${formatCurrency(vars.totalAmount || vars.total)}</p>
      ${vars.paymentMethod ? `<p><strong>Payment Method:</strong> ${escapeHtml(vars.paymentMethod)}</p>` : ''}
      ${vars.paymentStatus ? `<p><strong>Payment Status:</strong> ${escapeHtml(vars.paymentStatus)}</p>` : ''}
    </div>
  `

  return itemsHtml + totalsHtml
}

function buildShippingAddress(vars: TemplateVariables): string {
  if (!vars.shippingAddress) return ''
  const addr = vars.shippingAddress
  return `
    <div class="info-box">
      <h3>Shipping Address</h3>
      <p>${escapeHtml(addr.fullName)}</p>
      <p>${escapeHtml(addr.line1)}${addr.line2 ? ', ' + escapeHtml(addr.line2) : ''}</p>
      <p>${escapeHtml(addr.city)}, ${escapeHtml(addr.state)} ${escapeHtml(addr.pincode)}</p>
      <p>${escapeHtml(addr.country)}</p>
    </div>
  `
}

function buildInvoiceSection(vars: TemplateVariables): string {
  if (!vars.invoiceId && !vars.invoiceNumber) return ''
  return `
    <div class="info-box">
      <h3>Invoice Details</h3>
      ${vars.invoiceNumber ? `<p><strong>Invoice Number:</strong> ${escapeHtml(vars.invoiceNumber)}</p>` : ''}
      ${vars.invoiceId ? `<p><strong>Invoice ID:</strong> ${escapeHtml(vars.invoiceId)}</p>` : ''}
    </div>
  `
}

export class EmailTemplates {
  public static welcome(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Welcome to ${getBranding().brandName}!</h2>
      <p>Namaste ${escapeHtml(vars.customerName)},</p>
      <p>Thank you for joining the ${getBranding().brandName} family. We're delighted to have you with us!</p>
      <p>Discover stone-ground heritage millets, hand-rolled laddus, and pure unrefined wellness - crafted with love and tradition.</p>
      <div style="text-align: center;">
        <a href="${getBranding().website}" class="button">Start Shopping</a>
      </div>
      <p>If you have any questions, our support team is always here to help.</p>
    `
    const layout = buildLayout(content, 'Welcome to Vedhic Foods')
    return {
      subject: 'Welcome to Vedhic Foods',
      html: layout.html,
      text: layout.text,
    }
  }

  public static emailVerification(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const verificationUrl = `${getBranding().website}/verify-email?token=${vars.verificationToken || ''}`
    const content = `
      <h2>Verify Your Email Address</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Thank you for signing up with ${getBranding().brandName}. Please verify your email address to complete your registration.</p>
      <div style="text-align: center;">
        <a href="${verificationUrl}" class="button">Verify Email</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #4A9D5C;">${verificationUrl}</p>
      <p><small>This link will expire in 24 hours.</small></p>
    `
    const layout = buildLayout(content, 'Verify Your Email')
    return {
      subject: 'Verify your email address - Vedhic Foods',
      html: layout.html,
      text: layout.text,
    }
  }

  public static passwordReset(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const resetUrl = `${getBranding().website}/reset-password?token=${vars.resetToken || ''}`
    const content = `
      <h2>Reset Your Password</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>We received a request to reset your password for your ${getBranding().brandName} account.</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">Reset Password</a>
      </div>
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #4A9D5C;">${resetUrl}</p>
      <p><small>This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.</small></p>
    `
    const layout = buildLayout(content, 'Reset Your Password')
    return {
      subject: 'Password Reset Request - Vedhic Foods',
      html: layout.html,
      text: layout.text,
    }
  }

  public static orderConfirmation(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Order Confirmed!</h2>
      <p>Namaste ${escapeHtml(vars.customerName)},</p>
      <p>Thank you for your order! Your order has been confirmed and is being processed.</p>
      ${buildOrderSummary(vars)}
      ${buildShippingAddress(vars)}
      <p>We'll send you updates as your order progresses.</p>
    `
    const layout = buildLayout(content, 'Order Confirmed')
    return {
      subject: `Order Confirmed: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static paymentConfirmation(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Payment Confirmed!</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>We've received your payment for order ${escapeHtml(vars.orderNumber)}. Thank you!</p>
      ${buildOrderSummary(vars)}
      <p>Your order is now being processed and will be shipped soon.</p>
    `
    const layout = buildLayout(content, 'Payment Confirmed')
    return {
      subject: `Payment Confirmed: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static invoiceEmail(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Your Invoice</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Please find your invoice for order ${escapeHtml(vars.orderNumber)} attached to this email.</p>
      ${buildOrderSummary(vars)}
      ${buildInvoiceSection(vars)}
      <p>If you have any questions about this invoice, please don't hesitate to contact us.</p>
    `
    const layout = buildLayout(content, 'Invoice')
    return {
      subject: `Invoice #${vars.invoiceNumber || vars.invoiceId} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static orderProcessing(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Order Processing</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Your order ${escapeHtml(vars.orderNumber)} is being processed at our facility.</p>
      ${buildOrderSummary(vars)}
      <p>We'll notify you once it's shipped.</p>
    `
    const layout = buildLayout(content, 'Order Processing')
    return {
      subject: `Order Processing: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static shipping(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const trackingUrl = vars.trackingNumber ? `${getBranding().website}/track-order?tracking=${encodeURIComponent(vars.trackingNumber)}&order=${encodeURIComponent(String(vars.orderNumber ?? ''))}` : '#'
    const content = `
      <h2>Your Order Has Shipped!</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Great news! Your order ${escapeHtml(vars.orderNumber)} has been shipped.</p>
      <div class="info-box">
        ${vars.carrier ? `<p><strong>Carrier:</strong> ${escapeHtml(vars.carrier)}</p>` : ''}
        ${vars.trackingNumber ? `<p><strong>Tracking Number:</strong> ${escapeHtml(vars.trackingNumber)}</p>` : ''}
        ${vars.estimatedDelivery ? `<p><strong>Estimated Delivery:</strong> ${formatDate(vars.estimatedDelivery)}</p>` : ''}
      </div>
      ${buildOrderSummary(vars)}
      <div style="text-align: center;">
        <a href="${trackingUrl}" class="button">Track Your Order</a>
      </div>
    `
    const layout = buildLayout(content, 'Order Shipped')
    return {
      subject: `Order Shipped: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static outForDelivery(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Out for Delivery</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Your order ${escapeHtml(vars.orderNumber)} is out for delivery and will arrive soon!</p>
      ${vars.estimatedDelivery ? `<p><strong>Expected Delivery:</strong> ${formatDate(vars.estimatedDelivery)}</p>` : ''}
      ${buildOrderSummary(vars)}
      <p>Please ensure someone is available to receive the package.</p>
    `
    const layout = buildLayout(content, 'Out for Delivery')
    return {
      subject: `Out for Delivery: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static deliveryComplete(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Order Delivered!</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Your order ${escapeHtml(vars.orderNumber)} has been successfully delivered.</p>
      ${vars.deliveryDate ? `<p><strong>Delivered On:</strong> ${formatDate(vars.deliveryDate)}</p>` : ''}
      ${buildOrderSummary(vars)}
      <p>Thank you for choosing ${getBranding().brandName}! We hope you love your purchase.</p>
      <p>If you have any feedback or concerns, please reach out to our support team.</p>
    `
    const layout = buildLayout(content, 'Order Delivered')
    return {
      subject: `Delivered: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static paymentFailure(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Payment Failed</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Unfortunately, we couldn't process the payment for your order ${escapeHtml(vars.orderNumber)}.</p>
      ${vars.failureReason ? `<p><strong>Reason:</strong> ${escapeHtml(vars.failureReason)}</p>` : ''}
      ${buildOrderSummary(vars)}
      <p>Please try placing your order again or use a different payment method.</p>
      <div style="text-align: center;">
        <a href="${getBranding().website}/cart" class="button">Retry Payment</a>
      </div>
    `
    const layout = buildLayout(content, 'Payment Failed')
    return {
      subject: `Payment Failed: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static orderCancelled(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Order Cancelled</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>Your order ${escapeHtml(vars.orderNumber)} has been cancelled. Any reserved stock has been released.</p>
      ${vars.cancellationReason ? `<div class="info-box"><p><strong>Reason:</strong> ${escapeHtml(vars.cancellationReason)}</p></div>` : ''}
      ${buildOrderSummary(vars)}
      <p>If any payment was captured for this order, a refund will be processed to your original payment method.</p>
      <p>If you did not request this cancellation, please contact our support team immediately.</p>
    `
    const layout = buildLayout(content, 'Order Cancelled')
    return {
      subject: `Order Cancelled: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static refundProcessed(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Refund ${vars.refundStatus === 'processed' ? 'Processed' : 'Initiated'}</h2>
      <p>Hi ${escapeHtml(vars.customerName)},</p>
      <p>We've ${vars.refundStatus === 'processed' ? 'completed' : 'initiated'} a refund for your order ${escapeHtml(vars.orderNumber)}.</p>
      <div class="info-box">
${vars.refundId ? `<p><strong>Refund Reference:</strong> ${escapeHtml(vars.refundId)}</p>` : ''}
      ${vars.refundAmount !== undefined ? `<p><strong>Refund Amount:</strong> ${formatCurrency(vars.refundAmount)}</p>` : ''}
      ${vars.paymentMethod ? `<p><strong>Refunded To:</strong> ${escapeHtml(vars.paymentMethod)}</p>` : ''}
      </div>
      ${buildOrderSummary(vars)}
      <p>Refunds typically reflect in your account within 5-7 business days depending on your bank.</p>
      <p>If you have any questions, please reach out to our support team.</p>
    `
    const layout = buildLayout(content, 'Refund')
    return {
      subject: `Refund ${vars.refundStatus === 'processed' ? 'Processed' : 'Initiated'}: ${escapeHtml(vars.orderNumber)} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }

  public static adminNotification(vars: TemplateVariables): { subject: string; html: string; text: string } {
    const content = `
      <h2>Admin Notification</h2>
      <p>An important event requires your attention.</p>
      ${vars.adminMessage ? `<div class="info-box">${escapeHtml(vars.adminMessage)}</div>` : ''}
      ${vars.orderNumber ? buildOrderSummary(vars) : ''}
    `
    const layout = buildLayout(content, 'Admin Notification')
    return {
      subject: `Admin Alert: ${vars.orderNumber || 'System Notification'} - Vedhic Foods`,
      html: layout.html,
      text: layout.text,
    }
  }
}
