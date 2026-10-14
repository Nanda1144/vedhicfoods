import { Request, Response } from 'express'
import { PaymentMethod, RoleName, OrderStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { sendControllerError } from '../utils/api-response'
import { InvoiceEmailService } from '../services/invoice-email.service'
import { OrderEmailService } from '../services/order-email.service'
import { InvoiceData } from '../integrations/pdf/invoice-generator'
import { CheckoutService } from '../services/checkout.service'
import { InventoryService } from '../services/inventory.service'
import { RazorpayService } from '../integrations/razorpay/razorpay.service'
import { CheckoutInputDTO, checkoutSchema } from '../types/checkout.types'
import { confirmPaymentSchema, failPaymentSchema } from '../types/payment.types'
import {
  isValidOrderTransition,
  allowedOrderTransitions,
  inventoryDispositionForTransition,
} from '../utils/order-status'
import { clampPageNumber, clampPageSize, clampSearchTerm } from '../utils/pagination'
import { signOrderAccessToken } from '../utils/order-token'
import { publish } from '../events/realtime'

export class OrderController {
/**
   * POST /api/v1/orders/checkout  (and POST /api/v1/orders)
   * Storefront checkout adapter.
   *
   * The storefront posts a guest-friendly payload: customerName/customerEmail,
   * an inline address, slug-keyed `lines`, and a lowercase payment method.
   * This handler normalises that payload into the canonical CheckoutInputDTO and
   * delegates every pricing, stock, coupon and payment-state decision to
   * CheckoutService, so the platform has exactly one checkout implementation.
   */
  public static async checkout(req: Request, res: Response): Promise<void> {
    try {
      const {
        addressId,
        customerName,
        customerEmail,
        phone,
        address,
        addressLine,
        city,
        state,
        pincode,
        items,
        lines,
        paymentMethod = 'COD',
        couponCode,
        notes,
      } = req.body

      const rawItems: { productId: string; quantity: number }[] =
        Array.isArray(items) && items.length > 0
          ? items.map((i: any) => ({
              productId: String(i.productId || i.slug || ''),
              quantity: Number(i.quantity),
            }))
          : Array.isArray(lines)
            ? lines.map((l: any) => ({
                productId: String(l.slug || l.productId || ''),
                quantity: Number(l.quantity),
              }))
            : []

      const email = String(customerEmail || address?.email || '').toLowerCase().trim()
      const fullName = String(customerName || address?.fullName || '').trim()
      const contactPhone = String(phone || address?.phone || '').trim()
      const line1 = String(addressLine || address?.line1 || '').trim()
      const resolvedCity = String(city || address?.city || '').trim()
      const resolvedState = String(state || address?.state || '').trim()
      const resolvedPincode = String(pincode || address?.pincode || '').trim()

      if (!email || !fullName || rawItems.length === 0) {
        res.status(400).json({ error: 'Customer name, email, and order items are required.' })
        return
      }

      if (rawItems.some((i) => !i.productId || !Number.isFinite(i.quantity) || i.quantity < 1)) {
        res
          .status(400)
          .json({ error: 'Each order line requires a product and a quantity of at least 1.' })
        return
      }

      // Payment method and the canonical checkout schema are validated BEFORE any
      // identity side effect. Guest checkout previously created a throwaway user
      // row first and only then rejected the payload, so every 400 (missing
      // address field, unsupported method, ...) left an orphan account behind —
      // the source of the stale guest rows inflating the user count.
      const method = String(paymentMethod).toUpperCase()
      const supportedMethods = ['COD', 'RAZORPAY', 'UPI', 'CARD', 'NETBANKING']

      if (!supportedMethods.includes(method)) {
        res.status(400).json({ error: `Unsupported payment method '${paymentMethod}'.` })
        return
      }

      const dto: CheckoutInputDTO = {
        addressId: addressId ? String(addressId) : undefined,
        address: addressId
          ? undefined
          : {
              fullName,
              phone: contactPhone,
              line1,
              line2: address?.line2 || null,
              landmark: address?.landmark || null,
              city: resolvedCity,
              state: resolvedState,
              pincode: resolvedPincode,
              country: address?.country || 'India',
            },
        items: rawItems,
        paymentMethod: method as PaymentMethod,
        couponCode: couponCode || null,
        notes: notes || null,
      }

      // Validate through the canonical schema so this endpoint enforces exactly
      // the same rules as POST /api/v1/checkout.
      const parsed = checkoutSchema.safeParse(dto)

      if (!parsed.success) {
        const firstError = parsed.error.issues[0]?.message || 'Validation failed'
        logger.warn({ issues: parsed.error.issues }, 'Storefront checkout payload rejected')
        res.status(400).json({
          success: false,
          error: firstError,
          details: parsed.error.issues,
        })
        return
      }

      // ============================================================
      // CUSTOMER IDENTITY RESOLUTION
      //
      // SECURITY: the previous implementation looked the email up and, if any
      // account existed, silently attached the new order to it. That let an
      // unauthenticated caller with a victim's email address write orders into
      // that customer's account — polluting their order history and triggering
      // fulfilment and transactional mail against a real account.
      //
      // Rules now:
      //   - Email belongs to an existing account -> the caller must prove they
      //     own it by presenting a valid access token for that exact account.
      //   - Unknown email + no session -> a throwaway guest row is created.
      // ============================================================
      const sessionUserId = req.user?.id
      let user = await prisma.user.findUnique({ where: { email } })

      if (user) {
        if (!sessionUserId) {
          res.status(401).json({
            success: false,
            error:
              'An account already exists for this email address. Sign in to complete checkout, ' +
              'or use a different email address.',
          })
          return
        }

        if (sessionUserId !== user.id) {
          logger.warn(
            { sessionUserId, requestedEmail: email },
            'Checkout attempted against an email owned by another account'
          )
          res.status(403).json({
            success: false,
            error: 'The provided email address does not match the signed-in account.',
          })
          return
        }
      } else if (sessionUserId) {
        // Signed in, but checking out with a different email: the order belongs
        // to the signed-in account, not to a second identity keyed on email.
        user = await prisma.user.findUnique({ where: { id: sessionUserId } })
        if (!user) {
          res.status(401).json({ success: false, error: 'Account no longer exists.' })
          return
        }
      } else {
        // `phone` is UNIQUE across accounts. A guest number that collides with a
        // number already held by another account (a shared family mobile, or the
        // same person checking out under a different email) previously threw a
        // P2002 and turned guest checkout into a 500. The delivery phone is kept
        // on the order's shipping address regardless, so the throwaway guest row
        // simply omits it when the number is already claimed.
        const phoneClaimed = contactPhone
          ? await prisma.user.findUnique({ where: { phone: contactPhone }, select: { id: true } })
          : null

        user = await prisma.user.create({
          data: {
            email,
            fullName,
            phone: phoneClaimed ? null : contactPhone || null,
            // A real bcrypt hash over 32 random bytes rather than a literal
            // marker string such as 'guest_account'. The legacy SHA-256 fallback
            // in verifyPassword compares against whatever is stored, so a shared
            // constant would be a publicly known "password hash" that must never
            // exist in the table.
            passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
            role: 'CUSTOMER',
            isVerified: false,
          },
        })
      }

      const { response, isIdempotentReplay } = await CheckoutService.processCheckout(
        user.id,
        parsed.data
      )

      // Anonymous checkout: hand the browser a short-lived, order-bound token so
      // it can initiate/verify the Razorpay payment and read its own order and
      // invoice without having account credentials. Signed-in customers keep
      // using their access token and never receive one.
      const orderToken = !sessionUserId
        ? signOrderAccessToken({
            orderId: response.orderId,
            userId: user.id,
            email,
          })
        : undefined

      logger.info(
        {
          orderNumber: response.orderNumber,
          total: response.total,
          discount: response.discount,
          paymentMethod: response.paymentMethod,
          isIdempotentReplay,
        },
        'Storefront checkout completed via canonical CheckoutService'
      )

      // Generate A4 PDF invoice and send transactional email via Brevo
      const invoiceData: InvoiceData = {
        invoiceNumber: response.invoiceId || response.orderNumber,
        orderNumber: response.orderNumber,
        orderDate: new Date().toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        customerName: fullName,
        customerEmail: email,
        customerPhone: contactPhone,
        shippingAddress: {
          fullName,
          line1: line1 || 'Address provided at checkout',
          city: resolvedCity || 'City',
          state: resolvedState || 'State',
          pincode: resolvedPincode || '500001',
          country: 'India',
        },
        items: response.items,
        subtotal: response.subtotal,
        discount: response.discount,
        shipping: response.shipping,
        tax: response.tax,
        total: response.total,
        paymentMethod: method,
        paymentStatus:
          method === 'COD' ? 'Cash on Delivery (Pending)' : 'Payment Pending (Awaiting Razorpay)',
      }

      // Dispatch the invoice email asynchronously with the A4 PDF attached.
      InvoiceEmailService.sendOrderConfirmedInvoiceEmail(invoiceData).catch((err) => {
        logger.error({ error: err.message }, 'Failed to dispatch email with A4 invoice')
      })

      res.status(201).json({
        success: true,
        orderId: response.orderId,
        orderNumber: response.orderNumber,
        invoiceNumber: response.invoiceId || response.orderNumber,
        invoiceId: response.invoiceId || response.orderNumber,
        total: response.total,
        discount: response.discount,
        status: response.status,
        paymentStatus: response.paymentStatus,
        paymentMethod: response.paymentMethod,
        isIdempotentReplay,
        ...(orderToken ? { orderToken } : {}),
        message: 'Order confirmed successfully. Tax invoice sent to email.',
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to process checkout')
      sendControllerError(res, error, 'Failed to process checkout order', req.id)
    }
  }

  /**
   * GET /api/v1/admin/orders
   * Admin lists all orders from PostgreSQL.
   */
  public static async listOrders(req: Request, res: Response): Promise<void> {
    try {
      // PERFORMANCE: this was `findMany` with no `take`, no `skip` and no
      // `where` — every order ever placed, each with its full `items` relation,
      // serialised into one JSON body. On a real catalogue that is hundreds of
      // megabytes per request, it pins the Node heap, and it is a trivially
      // available memory-exhaustion vector for anyone holding an admin token.
      // Now paginated and capped, with the item projection narrowed to the
      // columns the table actually renders.
      const page = clampPageNumber(req.query.page)
      const limit = clampPageSize(req.query.limit ?? req.query.per_page, 25)

      const where: Record<string, unknown> = {}
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : ''
      if (status) where.status = status.toUpperCase()
      const search = clampSearchTerm(req.query.search ?? req.query.q)
      if (search) {
        where.OR = [
          { orderNumber: { contains: search, mode: 'insensitive' } },
          { customerEmail: { contains: search, mode: 'insensitive' } },
          { customerName: { contains: search, mode: 'insensitive' } },
        ]
      }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            subtotal: true,
            discount: true,
            shipping: true,
            tax: true,
            total: true,
            customerName: true,
            customerEmail: true,
            phone: true,
            createdAt: true,
            updatedAt: true,
            items: {
              select: {
                id: true,
                productId: true,
                name: true,
                sku: true,
                quantity: true,
                price: true,
                subtotal: true,
              },
            },
            user: {
              select: { id: true, fullName: true, email: true, phone: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.count({ where }),
      ])

      res.status(200).json({
        success: true,
        items: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list admin orders')
      res.status(500).json({ error: 'Failed to retrieve orders' })
    }
  }

  /**
   * PUT /api/v1/admin/orders/:id/status
   * Admin updates an order's status with automatic inventory restock on cancellation.
   */
  public static async updateOrderStatus(req: Request, res: Response): Promise<void> {
    try {
      const id = String(req.params.id)
      const { status } = req.body

      const existing = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      })

      if (!existing) {
        res.status(404).json({ error: 'Order not found' })
        return
      }

      if (existing.status === status) {
        res.status(200).json(existing)
        return
      }

      // SECURITY: the target status arrived as an unvalidated string and was passed
      // straight to Prisma, so any enum value was reachable from any state — one
      // request could take an unpaid order to DELIVERED, and because restocking only
      // fired on a CANCELLED/FAILED target, skipping those states left stock
      // deducted with no reversal. Transition is now checked against an explicit
      // matrix, and the body is validated as an OrderStatus first so an unknown value
      // is a clean 400 rather than a Prisma error surfacing as a 500.
      if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
        res.status(400).json({
          error: 'Invalid order status.',
          validStatuses: Object.values(OrderStatus),
        })
        return
      }

      if (!isValidOrderTransition(existing.status, status as OrderStatus)) {
        logger.warn(
          {
            orderId: id,
            orderNumber: existing.orderNumber,
            from: existing.status,
            to: status,
            actorId: req.user?.id,
          },
          'Rejected an illegal order status transition'
        )
        res.status(409).json({
          error: `Cannot move an order from ${existing.status} to ${status}.`,
          allowedTransitions: allowedOrderTransitions(existing.status),
        })
        return
      }

      const updated = await prisma.$transaction(async (tx) => {
        const orderUpdated = await tx.order.update({
          where: { id },
          data: { status },
        })

        // Return stock to available inventory. The correct operation depends on
        // how the ORDER holds its stock, not just the target status: a deducted
        // order (CONFIRMED..OUT_FOR_DELIVERY) must be restocked, an unpaid order
        // stuck in PENDING_PAYMENT holds only a reservation and must be released
        // (never credited to sold), and PENDING/PAYMENT_FAILED/FAILED/CANCELLED
        // orders hold nothing and must be left inert — restocking those
        // double-credits available stock and corrupts sold/reserved counters.
        const disposition = inventoryDispositionForTransition(existing.status, status as OrderStatus)
        if (disposition !== 'none') {
          const orderItems = existing.items
            .filter((i) => i.productId)
            .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

          const inventoryMetadata = {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            reason: `Order transitioned to ${status} by admin`,
            actorId: req.user?.id,
            actorEmail: req.user?.email,
          }

          if (disposition === 'release') {
            await InventoryService.releaseReservation(orderItems, inventoryMetadata, tx)
          } else if (disposition === 'restock') {
            await InventoryService.restockOrder(orderItems, inventoryMetadata, tx)
          }
        }

        return orderUpdated
      }, { timeout: 20000, maxWait: 15000 })

      logger.info({ orderId: id, status }, 'Order status updated in PostgreSQL')
      // Audit order status change
      try {
        await (await import('../services/audit.service')).AuditService.record({
          action: 'ORDER_STATUS_UPDATED',
          entity: 'Order',
          entityId: updated.id,
          metadata: {
            orderNumber: updated.orderNumber,
            previousStatus: existing.status,
            newStatus: status,
          },
          req,
        })
      } catch {}
      // Real-time push: staff consoles listening on `/events` refresh the order
      // list / detail without polling.
      publish('order.updated', {
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        status,
        previousStatus: existing.status,
        actorId: req.user?.id,
      })
      res.status(200).json(updated)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update order status')
      res.status(500).json({ error: 'Failed to update order status' })
    }
  }

  /**
   * Returns true when the caller holds staff-level privileges over orders.
   */
  private static isPrivilegedActor(req: Request): boolean {
    const user = req.user
    if (!user) return false
    return (
      user.roles.includes(RoleName.ADMIN) ||
      user.roles.includes(RoleName.OWNER) ||
      user.role === RoleName.ADMIN ||
      user.role === RoleName.OWNER ||
      user.permissions.includes('orders.cancel') ||
      user.permissions.includes('orders.update')
    )
  }

  /**
   * POST /api/v1/orders/:id/cancel
   * Cancel an order safely and restore warehouse stock.
   *
   * SECURITY: the ownership check is unconditional. It previously lived inside
   * `if (req.user)`, so an unauthenticated caller skipped authorization
   * entirely and could cancel (and restock) any order.
   */
  public static async cancelOrder(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    try {
      const id = String(req.params.id)
      const reason = req.body.reason || 'Order cancelled'

      const order = await prisma.order.findFirst({
        where: {
          OR: [{ id }, { orderNumber: id }],
        },
        include: { items: true },
      })

      if (!order) {
        res.status(404).json({ error: 'Order not found' })
        return
      }

      // Ownership / privilege check — never optional.
      if (!OrderController.isPrivilegedActor(req)) {
        const isOwner =
          order.userId === userId ||
          order.customerEmail.toLowerCase() === req.user!.email.toLowerCase()

        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: You do not have permission to cancel this order.' })
          return
        }
      }

      if (order.status === 'CANCELLED') {
        res.status(400).json({ error: 'Order is already cancelled' })
        return
      }

      if (order.status === 'DELIVERED') {
        res.status(400).json({ error: 'Delivered orders cannot be cancelled' })
        return
      }

      const orderItems = order.items
        .filter((i) => i.productId)
        .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

      // Inventory disposition depends on whether the order had already deducted
      // stock. A CONFIRMED/PROCESSING/... order holds sold stock (restock it back
      // to available); a PENDING_PAYMENT order only holds a reservation (release
      // it — never decrement soldQuantity, which was never incremented); a
      // FAILED/PAYMENT_FAILED order already released its reservation (inert).
      const deductedStatuses: string[] = [
        'CONFIRMED',
        'PROCESSING',
        'PACKED',
        'SHIPPED',
        'OUT_FOR_DELIVERY',
      ]
      const alreadyReleasedStatuses: string[] = ['FAILED', 'PAYMENT_FAILED']

      const updated = await prisma.$transaction(async (tx) => {
        const cancelledOrder = await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        })

        // Synchronize delivery record if present
        const delivery = await tx.delivery.findUnique({
          where: { orderId: order.id },
        })
        if (delivery && delivery.status !== 'CANCELLED') {
          await tx.delivery.update({
            where: { id: delivery.id },
            data: { status: 'CANCELLED' },
          })
          await tx.deliveryHistory.create({
            data: {
              deliveryId: delivery.id,
              status: 'CANCELLED',
              actorId: req.user?.id,
              actorEmail: req.user?.email,
              notes: 'Delivery cancelled along with order',
            },
          })
        }

        const inventoryContext = {
          orderId: order.id,
          orderNumber: order.orderNumber,
          reason,
          actorId: req.user?.id,
          actorEmail: req.user?.email,
        }

        if (deductedStatuses.includes(order.status)) {
          await InventoryService.restockOrder(orderItems, inventoryContext, tx)
        } else if (!alreadyReleasedStatuses.includes(order.status)) {
          await InventoryService.releaseReservation(orderItems, inventoryContext, tx)
        }

        return cancelledOrder
      }, { timeout: 20000, maxWait: 15000 })

      logger.info({ orderId: order.id, orderNumber: order.orderNumber }, 'Order cancelled and stock restocked successfully')

      // Customer cancellation notice. Best-effort and deduped per order.
      await OrderEmailService.orderCancelled(order.id, reason, `order_cancelled:${order.id}`)

      // Audit the cancellation — a money-moving, stock-affecting event.
      try {
        await (await import('../services/audit.service')).AuditService.record({
          action: 'ORDER_CANCELLED',
          entity: 'Order',
          entityId: order.id,
          metadata: {
            orderNumber: order.orderNumber,
            previousStatus: order.status,
            reason,
            total: Number(order.total),
          },
          req,
        })
      } catch {}

      res.status(200).json({
        success: true,
        message: 'Order cancelled successfully and stock restored to inventory',
        order: updated,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to cancel order')
      sendControllerError(res, error, 'Failed to cancel order', req.id)
    }
  }

  /**
   * POST /api/v1/orders/:id/confirm-payment
   *
   * SECURITY: this handler is a thin, signature-verifying adapter. It MUST NOT
   * mark an order paid on the client's say-so. All work is delegated to
   * RazorpayService.verifyAndConfirmPayment, which recomputes the HMAC-SHA256
   * signature from the server-side key secret and cross-checks amount +
   * ownership in the database.
   */
  public static async confirmPayment(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    try {
      const parsed = confirmPaymentSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid payment confirmation payload.',
          details: parsed.error.issues.map((i) => i.message),
        })
        return
      }

      const result = await RazorpayService.verifyAndConfirmPayment(
        {
          razorpayOrderId: parsed.data.razorpayOrderId,
          razorpayPaymentId: parsed.data.razorpayPaymentId,
          razorpaySignature: parsed.data.razorpaySignature,
        },
        userId,
        req.user?.email
      )

      res.status(200).json(result)
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to confirm payment')
      sendControllerError(res, error, 'Failed to confirm payment', req.id)
    }
  }

  /**
   * POST /api/v1/orders/:id/payment-failed
   *
   * SECURITY: only the order owner or staff with `orders.update` may mark a
   * payment failed. Unauthenticated callers are rejected outright — previously
   * this route ran under `optionalAuth` with no ownership check, which let any
   * anonymous client release arbitrary inventory reservations.
   */
  public static async failPayment(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    try {
      const id = String(req.params.id)
      const parsed = failPaymentSchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' })
        return
      }

      const order = await prisma.order.findFirst({
        where: { OR: [{ id }, { orderNumber: id }] },
        include: { items: true },
      })

      if (!order) {
        res.status(404).json({ error: 'Order not found' })
        return
      }

      // Ownership / privilege check — never optional.
      if (!OrderController.isPrivilegedActor(req)) {
        const isOwner =
          order.userId === userId ||
          order.customerEmail.toLowerCase() === req.user!.email.toLowerCase()

        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: You do not have permission to modify this order.' })
          return
        }
      }

      if (order.paymentStatus === 'PAID') {
        res.status(400).json({ error: 'Payment is already captured and cannot be marked failed.' })
        return
      }

      if (order.status === 'FAILED' || order.status === 'CANCELLED') {
        res.status(200).json({ success: true, message: 'Order is already marked failed/cancelled' })
        return
      }

      const orderItems = order.items
        .filter((i) => i.productId)
        .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

      const updated = await prisma.$transaction(async (tx) => {
        const ord = await tx.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: 'FAILED',
            status: 'FAILED',
          },
        })

        await InventoryService.releaseReservation(
          orderItems,
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
            reason: parsed.data.reason,
            actorId: userId,
            actorEmail: req.user?.email,
          },
          tx
        )

        return ord
      }, { timeout: 20000, maxWait: 15000 })

      // Customer payment-failure notice. Best-effort and deduped per order.
      await OrderEmailService.paymentFailed(order.id, parsed.data.reason, `payment_failed:${order.id}`)

      // Audit the payment failure / order failure event.
      try {
        await (await import('../services/audit.service')).AuditService.record({
          action: 'ORDER_PAYMENT_FAILED',
          entity: 'Order',
          entityId: order.id,
          metadata: {
            orderNumber: order.orderNumber,
            reason: parsed.data.reason,
            total: Number(order.total),
          },
          req,
        })
      } catch {}

      res.status(200).json({
        success: true,
        message: 'Payment marked as failed and reserved stock released',
        order: updated,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to process payment failure')
      res.status(error.statusCode || 500).json({ error: 'Failed to process payment failure' })
    }
  }

  /**
   * POST /api/v1/admin/orders/:id/refund
   *
   * Admin-initiated (full or partial) refund for a captured payment. The
   * gateway response is authoritative for the refund id/amount; the customer is
   * emailed a refund notice. Refunding is a money-moving operation, so this is
   * gated by `orders.update` at the router and re-validated in the service.
   */
  public static async refundOrder(req: Request, res: Response): Promise<void> {
    try {
      const actor = req.user
      if (!actor?.id) {
        res.status(401).json({ error: 'Authentication required.' })
        return
      }

      const id = String(req.params.id)
      const body = req.body ?? {}

      let amount: number | undefined
      if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
        amount = Number(body.amount)
        if (!Number.isFinite(amount) || amount <= 0) {
          res.status(400).json({ error: 'Refund amount must be a positive number.' })
          return
        }
      }

      const order = await prisma.order.findFirst({
        where: { OR: [{ id }, { orderNumber: id }] },
        include: { payment: true },
      })

      if (!order) {
        res.status(404).json({ error: 'Order not found' })
        return
      }

      if (!order.payment) {
        res.status(400).json({ error: 'This order has no captured payment to refund.' })
        return
      }

      const result = await RazorpayService.refundPayment({
        orderId: order.id,
        amount,
        reason: body.reason,
        actorId: actor.id,
        actorEmail: actor.email,
      })

      res.status(200).json({
        success: true,
        message: 'Refund processed successfully',
        data: result,
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to process refund')
      sendControllerError(res, error, 'Failed to process refund', req.id)
    }
  }

  /**
   * GET /api/v1/orders/my-orders
   * Fetches the current authenticated customer's order history.
   */
  public static async getMyOrders(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.id) {
        res.status(401).json({ error: 'Authentication required.' })
        return
      }

      // PERFORMANCE: unbounded per-customer read. A long-standing customer could
      // accumulate thousands of orders, each with its full item relation, and
      // the whole set was returned in one response. Now paginated and capped.
      const page = clampPageNumber(req.query.page)
      const limit = clampPageSize(req.query.limit ?? req.query.per_page, 10)

      // The `customerEmail` branch was dropped on purpose: it cannot use the
      // `userId` index, so including it forced a scan of the orders table on
      // every request. Orders are always created against a `userId` for an
      // authenticated buyer; guest orders are not visible on this endpoint.
      const where = { userId: req.user.id }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            items: {
              select: {
                id: true,
                productId: true,
                name: true,
                image: true,
                quantity: true,
                price: true,
                subtotal: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.order.count({ where }),
      ])

      res.status(200).json({
        success: true,
        items: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list my orders')
      res.status(500).json({ error: 'Failed to retrieve orders' })
    }
  }

  /**
   * GET /api/v1/orders/:orderNumberOrId
   * Fetch single order by order number, ID, or invoice ID.
   *
   * SECURITY: customer isolation is enforced unconditionally. The check used to
   * sit inside `if (req.user)`, so anonymous callers could read any order —
   * including customer email, phone and the full shipping address snapshot.
   */
  public static async getOrder(req: Request, res: Response): Promise<void> {
    const userId = req.user?.id
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    try {
      const orderNumberOrId = String(req.params.orderNumberOrId)
      const order = await prisma.order.findFirst({
        where: {
          OR: [
            { id: orderNumberOrId },
            { orderNumber: orderNumberOrId },
            { invoiceId: orderNumberOrId },
          ],
        },
        include: {
          items: true,
        },
      })

      if (!order) {
        res.status(404).json({ error: 'Order not found' })
        return
      }

      // Customer Isolation Check — never optional.
      if (!OrderController.isPrivilegedActor(req)) {
        const isOwner =
          order.userId === userId ||
          order.customerEmail.toLowerCase() === req.user!.email.toLowerCase()

        if (!isOwner) {
          res.status(403).json({ error: 'Forbidden: You do not have permission to view this order.' })
          return
        }
      }

      res.status(200).json(order)
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get order details')
      res.status(500).json({ error: 'Failed to retrieve order' })
    }
  }
}
