import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AppError } from '../utils/errors'
import { HTTP_STATUS, ERROR_CODES } from '../constants'
import { InvoiceGenerator, InvoiceData, InvoiceItem } from '../integrations/pdf/invoice-generator'
import { S3Service } from '../integrations/aws/s3/s3.service'
import { OrderStatus, PaymentStatus, InvoiceStatus } from '@prisma/client'
import { InvoiceEmailService } from './invoice-email.service'

export interface InvoiceListParams {
  userId?: string
  status?: InvoiceStatus
  page?: number
  limit?: number
  search?: string
  startDate?: Date
  endDate?: Date
}

export interface PaginatedInvoices {
  invoices: InvoiceWithRelations[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface InvoiceWithRelations {
  id: string
  invoiceNumber: string
  orderId: string
  userId: string
  status: InvoiceStatus
  invoiceDate: Date
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
  paymentStatus: PaymentStatus
  s3PdfKey: string | null
  pdfUrl: string | null
  createdAt: Date
  updatedAt: Date
  order: {
    id: string
    orderNumber: string
    customerName: string
    customerEmail: string
    customerPhone: string | null
    shippingAddressSnapshot: any
    billingAddressSnapshot: any
    items: Array<{
      id: string
      productId: string | null
      name: string
      sku: string
      unit: string
      price: number
      quantity: number
      subtotal: number
    }>
    subtotal: number
    discount: number
    shipping: number
    tax: number
    total: number
    currency: string
    paymentMethod: string
    placedAt: Date
  }
}

export class InvoiceService {
  private static readonly INVOICE_NUMBER_PREFIX = 'INV'
  private static readonly S3_KEY_PREFIX = 'invoices'

  /**
   * Generates the next sequential invoice number.
   * Format: INV-YYYY-XXXXXX (e.g., INV-2026-000001)
   */
  private static async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear()
    const prefix = `${this.INVOICE_NUMBER_PREFIX}-${year}-`
    
    const lastInvoice = await prisma.invoice.findFirst({
      where: {
        invoiceNumber: { startsWith: prefix }
      },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true }
    })

    let sequence = 1
    if (lastInvoice) {
      const lastSequence = parseInt(lastInvoice.invoiceNumber.replace(prefix, ''), 10)
      sequence = lastSequence + 1
    }

    return `${prefix}${sequence.toString().padStart(6, '0')}`
  }

  /**
   * Builds InvoiceData from order for PDF generation.
   */
  private static buildInvoiceData(order: any, invoiceNumber: string): InvoiceData {
    const items: InvoiceItem[] = order.items.map((item: any) => ({
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      price: Number(item.price),
      quantity: item.quantity,
      subtotal: Number(item.subtotal),
    }))

    const shippingAddress = order.shippingAddressSnapshot || {}

    return {
      invoiceNumber,
      orderNumber: order.orderNumber,
      orderDate: order.createdAt.toISOString().split('T')[0],
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.phone || undefined,
      shippingAddress: {
        fullName: shippingAddress.fullName || order.customerName,
        line1: shippingAddress.line1 || '',
        line2: shippingAddress.line2 || undefined,
        city: shippingAddress.city || '',
        state: shippingAddress.state || '',
        pincode: shippingAddress.pincode || '',
        country: shippingAddress.country || 'India',
      },
      items,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      shipping: Number(order.shipping),
      tax: Number(order.tax),
      total: Number(order.total),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
    }
  }

  /**
   * Creates an invoice for an order after successful payment.
   * Called after payment confirmation (via webhook or frontend verification).
   */
  public static async createInvoiceForOrder(orderId: string): Promise<InvoiceWithRelations> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payment: true,
      },
    })

    if (!order) {
      throw new AppError('Order not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    // Check if invoice already exists
    const existingInvoice = await prisma.invoice.findUnique({
      where: { orderId },
    })

    if (existingInvoice) {
      logger.info({ orderId, invoiceId: existingInvoice.id }, 'Invoice already exists for order')
      return this.getInvoiceById(existingInvoice.id) as Promise<InvoiceWithRelations>
    }

    // Only create invoice for paid orders
    if (order.paymentStatus !== PaymentStatus.PAID) {
      throw new AppError(
        'Invoice can only be created for paid orders',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    const invoiceNumber = await this.generateInvoiceNumber()

    // Generate PDF
    const pdfData = this.buildInvoiceData(order, invoiceNumber)
    const pdfBuffer = await InvoiceGenerator.generateA4Pdf(pdfData)

    // Upload to S3
    const s3Key = `${this.S3_KEY_PREFIX}/${order.userId}/${invoiceNumber}.pdf`
    const pdfUrl = await S3Service.uploadDocument({
      key: s3Key,
      body: pdfBuffer,
      contentType: 'application/pdf',
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        customerEmail: order.customerEmail,
      },
    })

    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        userId: order.userId,
        status: InvoiceStatus.ISSUED,
        invoiceDate: new Date(),
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        tax: order.tax,
        total: order.total,
        paymentStatus: order.paymentStatus,
        s3PdfKey: s3Key,
        pdfUrl,
      },
    })

    // Update order status to CONFIRMED if still PENDING_PAYMENT
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CONFIRMED,
        },
      })
    }

    logger.info({ invoiceId: invoice.id, invoiceNumber, orderId }, 'Invoice created successfully')

    // Send the tax invoice (A4 PDF attached) to the customer, plus a printable
    // confirmation copy to the admin. Both are best-effort: invoice generation
    // from the paid order is authoritative and must not fail on a mail hiccup.
    try {
      // Audit invoice generation
      try {
        await import('./audit.service').then(({ AuditService }) =>
          AuditService.record({
            action: 'INVOICE_GENERATED',
            entity: 'Invoice',
            entityId: invoice.id,
            metadata: {
              invoiceNumber: invoice.invoiceNumber,
              orderId: order.id,
              orderNumber: order.orderNumber,
              total: Number(invoice.total),
            },
          })
        )
      } catch {}

      // Customer copy — official A4 tax invoice as a PDF attachment.
      await InvoiceEmailService.sendOrderConfirmedInvoiceEmail(pdfData)
      logger.info({ invoiceId: invoice.id }, 'Invoice email sent to customer')

      // Admin copy — printable tax invoice, so the team can print/file it.
      await InvoiceEmailService.sendAdminInvoiceEmail(pdfData, pdfBuffer)
      logger.info({ invoiceId: invoice.id }, 'Invoice copy sent to admin')
    } catch (emailError: any) {
      logger.error({ error: emailError.message, invoiceId: invoice.id }, 'Failed to send invoice email')
      // Do not block the transaction/process; email sending failure is handled gracefully
    }

    return this.getInvoiceById(invoice.id) as Promise<InvoiceWithRelations>
  }

  /**
   * Gets a single invoice by ID with full relations.
   */
  public static async getInvoiceById(invoiceId: string): Promise<InvoiceWithRelations | null> {
    // Accept either the internal UUID or the human-readable INV-YYYY-XXXXXX
    // number. Storefront links and email receipts carry the public number.
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [{ id: invoiceId }, { invoiceNumber: invoiceId }],
      },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    if (!invoice) return null

    return this.transformInvoice(invoice)
  }

  /**
   * Gets invoice by order ID.
   *
   * Accepts either the order's internal UUID or its human-readable order
   * number, resolving through the Order record before looking up the invoice.
   */
  public static async getInvoiceByOrderId(orderIdOrNumber: string): Promise<InvoiceWithRelations | null> {
    const trimmed = orderIdOrNumber.trim()

    const order = await prisma.order.findFirst({
      where: {
        OR: [{ id: trimmed }, { orderNumber: trimmed }],
      },
      select: { id: true },
    })

    if (!order) return null

    const invoice = await prisma.invoice.findUnique({
      where: { orderId: order.id },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    if (!invoice) return null

    return this.transformInvoice(invoice)
  }

  /**
   * Lists invoices with filtering and pagination.
   */
  public static async listInvoices(params: InvoiceListParams): Promise<PaginatedInvoices> {
    const {
      userId,
      status,
      page = 1,
      limit = 20,
      search,
      startDate,
      endDate,
    } = params

    const where: any = {}

    if (userId) {
      where.userId = userId
    }

    if (status) {
      where.status = status
    }

    if (startDate || endDate) {
      where.invoiceDate = {}
      if (startDate) where.invoiceDate.gte = startDate
      if (endDate) where.invoiceDate.lte = endDate
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
        { order: { customerName: { contains: search, mode: 'insensitive' } } },
        { order: { customerEmail: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          order: {
            include: {
              items: true,
            },
          },
        },
        orderBy: { invoiceDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ])

    return {
      invoices: invoices.map(this.transformInvoice),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Generates a fresh signed download URL for an invoice PDF.
   * Returns a presigned URL valid for 1 hour.
   *
   * `isAdmin` is threaded from the controller, which has already applied the
   * platform-wide authorization rule (OWNER/ADMIN or `invoices.read`). Without
   * it the service re-checked ownership against the *caller's* id, so an admin
   * could read any invoice but was forbidden from downloading it.
   */
  public static async getInvoiceDownloadUrl(
    invoiceId: string,
    userId: string,
    isAdmin = false
  ): Promise<string> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    })

    if (!invoice) {
      throw new AppError('Invoice not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    // Authorization: a user can only download their own invoices.
    if (!isAdmin && invoice.userId !== userId) {
      throw new AppError('Unauthorized to access this invoice', HTTP_STATUS.FORBIDDEN, ERROR_CODES.FORBIDDEN)
    }

    if (!invoice.s3PdfKey) {
      throw new AppError('Invoice PDF not available', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    // Generate presigned URL (1 hour expiry)
    return S3Service.generatePresignedDownloadUrl(invoice.s3PdfKey, 3600)
  }

  /**
   * Regenerates invoice PDF and re-uploads to S3.
   * Useful if PDF was corrupted or needs update.
   */
  public static async regenerateInvoicePdf(invoiceId: string): Promise<InvoiceWithRelations> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    if (!invoice) {
      throw new AppError('Invoice not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    // Generate new PDF
    const invoiceData = this.buildInvoiceData(invoice.order, invoice.invoiceNumber)
    const pdfBuffer = await InvoiceGenerator.generateA4Pdf(invoiceData)

    // Upload to S3 (overwrites existing)
    const s3Key = `${this.S3_KEY_PREFIX}/${invoice.userId}/${invoice.invoiceNumber}.pdf`
    const pdfUrl = await S3Service.uploadDocument({
      key: s3Key,
      body: pdfBuffer,
      contentType: 'application/pdf',
      metadata: {
        orderId: invoice.orderId,
        orderNumber: invoice.order.orderNumber,
        invoiceNumber: invoice.invoiceNumber,
        customerEmail: invoice.order.customerEmail,
        regenerated: 'true',
        regeneratedAt: new Date().toISOString(),
      },
    })

    // Update invoice record
    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        s3PdfKey: s3Key,
        pdfUrl,
        updatedAt: new Date(),
      },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    logger.info({ invoiceId }, 'Invoice PDF regenerated successfully')

    return this.transformInvoice(updated)
  }

  /**
   * Marks invoice as cancelled (voids it).
   */
  public static async cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceWithRelations> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    })

    if (!invoice) {
      throw new AppError('Invoice not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError('Invoice already cancelled', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
    }

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.CANCELLED,
        updatedAt: new Date(),
      },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    logger.info({ invoiceId, reason }, 'Invoice cancelled')

    return this.transformInvoice(updated)
  }

  /**
   * Transforms Prisma invoice to our response type.
   */
  private static transformInvoice(invoice: any): InvoiceWithRelations {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      orderId: invoice.orderId,
      userId: invoice.userId,
      status: invoice.status,
      invoiceDate: invoice.invoiceDate,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      shipping: Number(invoice.shipping),
      tax: Number(invoice.tax),
      total: Number(invoice.total),
      paymentStatus: invoice.paymentStatus,
      s3PdfKey: invoice.s3PdfKey,
      pdfUrl: invoice.pdfUrl,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      order: {
        id: invoice.order.id,
        orderNumber: invoice.order.orderNumber,
        customerName: invoice.order.customerName,
        customerEmail: invoice.order.customerEmail,
        customerPhone: invoice.order.phone,
        shippingAddressSnapshot: invoice.order.shippingAddressSnapshot,
        billingAddressSnapshot: null,
        items: invoice.order.items.map((item: any) => ({
          id: item.id,
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          price: Number(item.price),
          quantity: item.quantity,
          subtotal: Number(item.subtotal),
        })),
        subtotal: Number(invoice.order.subtotal),
        discount: Number(invoice.order.discount),
        shipping: Number(invoice.order.shipping),
        tax: Number(invoice.order.tax),
        total: Number(invoice.order.total),
        currency: invoice.order.currency,
        paymentMethod: invoice.order.paymentMethod,
        placedAt: invoice.order.createdAt,
      },
    }
  }
}