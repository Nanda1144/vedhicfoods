import { randomInt } from 'node:crypto'
import { prisma } from '../config/database'
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '../utils/errors'
import { InventoryService } from './inventory.service'
import { CartService } from './cart.service'
import { logger } from '../config/logger'
import {
  CheckoutInputDTO,
  CheckoutResponse,
  VALID_ORDER_TRANSITIONS,
} from '../types/checkout.types'
import { OrderStatus, PaymentStatus, PaymentMethod, PaymentRecordStatus, DeliveryStatus } from '@prisma/client'
import { DiscountService } from './discount.service'
import { DiscountableItem } from '../types/discount.types'
import { EmailService } from './email.service'
import { AuditService } from './audit.service'
import { PaymentSettingsService } from './payment-settings.service'
import { publish } from '../events/realtime'

export class CheckoutService {
  /**
   * Generates a unique, human-readable order number: VF-YYYY-NNNNNN
   */
  public static generateOrderNumber(): string {
    const year = new Date().getFullYear()
    const randomDigits = randomInt(100000, 1000000)
    return `VF-${year}-${randomDigits}`
  }

  /**
   * Complete transactional checkout workflow connecting:
   * Cart -> Address -> Inventory -> Pricing -> Discount -> Order -> Payment Preparation
   */
  public static async processCheckout(
    userId: string,
    input: CheckoutInputDTO,
    headerIdempotencyKey?: string
  ): Promise<{ response: CheckoutResponse; isIdempotentReplay: boolean }> {
    const idempotencyKey = input.idempotencyKey || headerIdempotencyKey || null

    // PERFORMANCE: the idempotency probe, the customer lookup and the address
    // lookup are mutually independent — none reads another's result. They were
    // awaited one after another, adding three sequential network round trips to
    // every checkout before any work began. Issue them together; depth 3 -> 1.
    const [existingOrder, user, addr] = await Promise.all([
      idempotencyKey
        ? prisma.order.findUnique({
            where: { idempotencyKey },
            include: {
              items: true,
              payment: true,
            },
          })
        : Promise.resolve(null),

      prisma.user.findUnique({
        where: { id: userId },
      }),

      input.addressId
        ? prisma.address.findUnique({
            where: { id: input.addressId },
          })
        : Promise.resolve(null),
    ])

    // 1. Idempotency Check: Return existing order if key matches
    if (existingOrder) {
      // SECURITY: an idempotency key is client-supplied. Without an ownership
      // check a caller who reuses (or guesses) another account's key would be
      // handed that account's full order — totals, address snapshot and items.
      if (existingOrder.userId !== userId) {
        throw new ConflictError('This idempotency key has already been used for another account')
      }

      logger.info(
        { orderNumber: existingOrder.orderNumber, idempotencyKey },
        'Idempotent checkout replay detected: returning previously created order'
      )
      return {
        response: CheckoutService.formatOrderResponse(existingOrder),
        isIdempotentReplay: true,
      }
    }

    // 2. Authenticated customer must be valid and active.
    if (!user || user.isDeleted || !user.isActive) {
      throw new ForbiddenError('Authenticated customer account is invalid or inactive')
    }

    // SECURITY/UX: do not create an online order (and reserve inventory) when the
    // operator has disabled the gateway or the selected method. The storefront
    // hides these options, but requests are not trusted to do so.
    if (input.paymentMethod !== PaymentMethod.COD) {
      await PaymentSettingsService.assertOnlinePaymentAllowed(input.paymentMethod)
    }

    // 3. Resolve Delivery Address & Build Immutable Snapshot
    let resolvedAddressId: string | null = null
    let shippingAddressSnapshot: any

    if (input.addressId) {
      if (!addr || addr.isDeleted) {
        throw new NotFoundError(`Delivery address '${input.addressId}' not found`)
      }

      // Strict Ownership Check: Address must belong to THIS customer
      if (addr.userId !== userId) {
        throw new ForbiddenError("You are not authorized to use another customer's address for delivery")
      }

      resolvedAddressId = addr.id
      shippingAddressSnapshot = {
        fullName: addr.fullName,
        phone: addr.phone,
        line1: addr.line1,
        line2: addr.line2 || null,
        landmark: addr.landmark || null,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
        country: addr.country || 'India',
      }
    } else if (input.address) {
      shippingAddressSnapshot = {
        fullName: input.address.fullName,
        phone: input.address.phone,
        line1: input.address.line1,
        line2: input.address.line2 || null,
        landmark: input.address.landmark || null,
        city: input.address.city,
        state: input.address.state,
        pincode: input.address.pincode,
        country: input.address.country || 'India',
      }
    } else {
      throw new BadRequestError('A valid delivery address must be provided')
    }

    // 4. Resolve Order Items (from input items or customer PostgreSQL cart)
    let rawItems: { productId: string; quantity: number }[] = []

    if (Array.isArray(input.items) && input.items.length > 0) {
      rawItems = input.items
    } else {
      const cart = await CartService.getOrCreateCart(userId)
      if (!cart || !cart.items || cart.items.length === 0) {
        throw new BadRequestError('Cannot checkout with an empty cart. Please add items before placing an order.')
      }
      rawItems = cart.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      }))
    }

    if (rawItems.length === 0) {
      throw new BadRequestError('Cannot checkout with an empty cart')
    }

    // 5. Authoritative Product, Pricing, and Inventory Verification
    const reservationItems: { productId: string; quantity: number }[] = []
    const orderItemsData: any[] = []
    const discountableItems: DiscountableItem[] = []
    let subtotal = 0
    let totalSavings = 0

    // PERFORMANCE (N+1 fix): every line below used to run its own
    // `product.findFirst`, so a 10-item cart cost 10 round trips (~30 SQL
    // statements with the `inventory` + `images` includes) before the order
    // could even be priced. Only the primary image is ever read, so the images
    // relation is also capped at one row. Batch-loaded up front: 10 round trips
    // -> 1, and the per-line validation, pricing and stock checks below are
    // unchanged so the authoritative-money guarantees are preserved.
    const requestedIds = rawItems.map((i) => String(i.productId))
    const loadedProducts = await prisma.product.findMany({
      where: {
        OR: [{ id: { in: requestedIds } }, { slug: { in: requestedIds } }],
        isDeleted: false,
      },
      include: {
        inventory: true,
        images: { take: 1, orderBy: [{ isPrimary: 'desc' }, { displayOrder: 'asc' }] },
      },
    })

    const productById = new Map(loadedProducts.map((p) => [p.id, p]))
    const productBySlug = new Map(loadedProducts.map((p) => [p.slug, p]))

    for (const item of rawItems) {
      const qty = parseInt(String(item.quantity), 10)
      if (isNaN(qty) || qty <= 0) {
        throw new BadRequestError('Item quantity must be a positive integer')
      }

      // `id` wins over `slug` when a value could match either, matching the
      // `OR` ordering of the original per-item lookup.
      const requested = String(item.productId)
      const product = productById.get(requested) ?? productBySlug.get(requested)

      if (!product) {
        throw new NotFoundError(`Product '${item.productId}' not found or no longer available`)
      }

      if (!product.isActive || product.status !== 'PUBLISHED') {
        throw new BadRequestError(`Product '${product.name}' is currently unavailable for purchase`)
      }

      const availableStock = product.inventory
        ? Number(product.inventory.availableQuantity)
        : Number(product.stock || 0)

      if (availableStock <= 0) {
        throw new BadRequestError(`Cannot place order: Product '${product.name}' is out of stock`)
      }

      if (qty > availableStock) {
        throw new BadRequestError(
          `Insufficient stock for '${product.name}'. Available: ${availableStock}, Requested: ${qty}`
        )
      }

      reservationItems.push({ productId: product.id, quantity: qty })

      // Authoritative financial calculations (never trusting client prices)
      const currentPrice = Number(product.price)
      const mrp = Number(product.mrp || currentPrice)
      const lineSubtotal = Math.round(currentPrice * qty * 100) / 100
      const lineSavings = Math.round(Math.max(0, mrp - currentPrice) * qty * 100) / 100

      subtotal = Math.round((subtotal + lineSubtotal) * 100) / 100
      totalSavings = Math.round((totalSavings + lineSavings) * 100) / 100

      orderItemsData.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit || 'piece',
        image: product.images[0]?.imageUrl || '',
        price: currentPrice,
        unitPrice: currentPrice,
        quantity: qty,
        subtotal: lineSubtotal,
        discount: lineSavings,
      })

      discountableItems.push({
        productId: product.id,
        categoryId: product.categoryId,
        price: currentPrice,
        quantity: qty,
        name: product.name,
      })
    }

    // 6. Authoritative Discount & Coupon Calculation using DiscountService
    let discount = 0
    let validatedCouponResult: any = null

    if (input.couponCode) {
      validatedCouponResult = await DiscountService.validateAndCalculateCoupon({
        code: input.couponCode,
        items: discountableItems,
        userId,
      })

      discount = validatedCouponResult.discountAmount
    }

    // 7. Shipping Calculation (Free above Rs. 499, else Rs. 49)
    const shipping = subtotal >= 499 ? 0 : 49

    // 8. Tax Calculation (5% GST on organic food items)
    const taxableAmount = Math.max(0, subtotal - discount)
    const tax = Math.round(taxableAmount * 0.05 * 100) / 100

    // 9. Final Total
    const total = Math.round((taxableAmount + shipping + tax) * 100) / 100

    const orderNumber = CheckoutService.generateOrderNumber()
    const isCod = input.paymentMethod === PaymentMethod.COD

    // 10. Database Transaction Execution
    let order: any
    try {
    order = await prisma.$transaction(async (tx) => {
      // Step A: Atomic Inventory Reservation with row-level locks
      await InventoryService.reserveStock(
        reservationItems,
        {
          orderNumber,
          actorId: user.id,
          actorEmail: user.email,
          reason: `Checkout inventory reservation for ${orderNumber}`,
        },
        tx
      )

      // Step B: Create Order Record
      const createdOrder = await tx.order.create({
        data: {
          orderNumber,
          idempotencyKey,
          userId: user.id,
          addressId: resolvedAddressId,
          customerName: shippingAddressSnapshot.fullName,
          customerEmail: user.email.toLowerCase().trim(),
          phone: shippingAddressSnapshot.phone,
          subtotal,
          savings: totalSavings,
          shipping,
          tax,
          discount,
          total,
          currency: 'INR',
          // Order states: COD is confirmed on checkout; online payment starts in PENDING_PAYMENT
          status: isCod ? OrderStatus.CONFIRMED : OrderStatus.PENDING_PAYMENT,
          // CRITICAL: Do not mark an order as paid merely because checkout succeeded!
          paymentStatus: PaymentStatus.PENDING,
          paymentMethod: input.paymentMethod,
          couponCode: validatedCouponResult ? validatedCouponResult.code : null,
          notes: input.notes || null,
          // `invoiceId` is deliberately left unset here. A real, sequentially
          // numbered Invoice row is created only after payment capture
          // (InvoiceService.createInvoiceForOrder). A previous version minted a
          // phantom `INV-YYYY-<epoch>` string at checkout, which the UI and the
          // confirmation email then presented as a tax-invoice number even though
          // no such invoice existed - producing two different "official" invoice
          // numbers per order and a broken download link.
          shippingAddressSnapshot,
          items: {
            create: orderItemsData,
          },
        },
        include: {
          items: true,
        },
      })

      // Step B1: Audit — order creation is a sensitive financial event.
      await AuditService.record({
        action: 'ORDER_CREATED',
        entity: 'Order',
        entityId: createdOrder.id,
        actorId: user.id,
        actorEmail: user.email,
        metadata: {
          orderNumber: createdOrder.orderNumber,
          total: Number(createdOrder.total),
          status: createdOrder.status,
          paymentMethod: createdOrder.paymentMethod,
          couponCode: createdOrder.couponCode || null,
        },
        tx,
      })

      // Step B2: Real-time push — a staff console with an open `/events` stream
      // sees the new order appear without polling. Non-critical by design.
      publish('order.created', {
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
        status: createdOrder.status,
        total: Number(createdOrder.total),
      })

      // Step C: Payment Record Preparation
      // For RAZORPAY payment method: razorpayOrderId is initially null.
      // The real Razorpay order is created when the customer calls POST /api/v1/payments/razorpay/order.
      // This two-step approach keeps checkout atomic and Razorpay initiation separate.
      // For COD: no Razorpay order needed, record is created immediately with PENDING status.
      await tx.payment.create({
        data: {
          orderId: createdOrder.id,
          razorpayOrderId: null, // Populated by POST /payments/razorpay/order for online payments
          amount: total,
          currency: 'INR',
          status: PaymentRecordStatus.PENDING,
          method: input.paymentMethod,
          metadata: {
            customerEmail: user.email,
            customerPhone: shippingAddressSnapshot.phone,
          },
        },
      })


      // Step C2: Delivery Provisioning
      await tx.delivery.create({
        data: {
          orderId: createdOrder.id,
          status: DeliveryStatus.PENDING,
          courierPartner: 'Delhivery Express',
          recipientName: shippingAddressSnapshot.fullName,
          recipientPhone: shippingAddressSnapshot.phone,
          history: {
            create: {
              status: DeliveryStatus.PENDING,
              actorId: user.id,
              actorEmail: user.email,
              notes: `Order created via checkout (${input.paymentMethod})`,
            },
          },
        },
      })

      // Step C3: Audit — delivery record created alongside the order.
      await AuditService.record({
        action: 'DELIVERY_CREATED',
        entity: 'Delivery',
        entityId: '',
        actorId: user.id,
        actorEmail: user.email,
        metadata: {
          orderId: createdOrder.id,
          orderNumber,
          status: DeliveryStatus.PENDING,
        },
        tx,
      })

      // Step D: Confirm deduction if COD, else stock remains in reservedQuantity awaiting online payment confirmation
      if (isCod) {
        await InventoryService.confirmDeduction(
          reservationItems,
          {
            orderId: createdOrder.id,
            orderNumber,
            actorId: user.id,
            actorEmail: user.email,
            reason: `Cash on Delivery checkout deduction for ${orderNumber}`,
          },
          tx
        )
      }

      // Step E: Clear checked-out items from user's PostgreSQL cart
      const userCart = await tx.cart.findFirst({
        where: { userId: user.id },
      })
      if (userCart) {
        const productIds = reservationItems.map((r) => r.productId)
        await tx.cartItem.deleteMany({
          where: {
            cartId: userCart.id,
            productId: { in: productIds },
          },
        })
      }

      // Step F: Atomically record coupon usage, preventing race conditions and tracking COUPON_USED audit log
      if (validatedCouponResult) {
        await DiscountService.recordCouponUsage(
          {
            couponId: validatedCouponResult.couponId,
            userId: user.id,
            orderId: createdOrder.id,
            discountApplied: discount,
            actorEmail: user.email,
          },
          tx
        )
      }

      return createdOrder
    }, { timeout: 30000, maxWait: 20000 })
    } catch (error: any) {
      // Concurrent double-submit with the same idempotency key: the unique
      // constraint aborts the losing transaction, which has already been rolled
      // back, so no partial order or inventory change survives. Resolve the
      // collision into the same replay response the sequential path returns
      // rather than surfacing a raw 409 conflict.
      if (idempotencyKey && error?.code === 'P2002') {
        const replayed = await prisma.order.findUnique({
          where: { idempotencyKey },
          include: { items: true, payment: true },
        })
        if (replayed && replayed.userId === userId) {
          logger.info(
            { orderNumber: replayed.orderNumber, idempotencyKey },
            'Concurrent idempotent checkout collision resolved: returning existing order'
          )
          return {
            response: CheckoutService.formatOrderResponse(replayed),
            isIdempotentReplay: true,
          }
        }
      }
      throw error
    }

    logger.info(
      { orderNumber: order.orderNumber, total: order.total, status: order.status },
      'Checkout completed and order created in PostgreSQL'
    )

    // Send order confirmation email (non-blocking)
    try {
      const orderItems = order.items.map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        price: Number(item.unitPrice ?? item.price),
        total: Number(item.subtotal),
      }))

      await EmailService.sendOrderConfirmation({
        customerEmail: order.customerEmail,
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        orderId: order.id,
        totalAmount: Number(order.total),
        subtotal: Number(order.subtotal),
        discount: Number(order.discount),
        shipping: Number(order.shipping),
        tax: Number(order.tax),
        paymentMethod: order.paymentMethod,
        items: orderItems,
      })
    } catch (emailError: any) {
      logger.error({ error: emailError.message, orderId: order.id }, 'Failed to send order confirmation email')
    }

    // Cash-on-delivery orders are confirmed at checkout, so no payment-capture
    // webhook will ever fire to create their tax invoice. Generate it here
    // instead. Non-fatal and idempotent: a failure leaves the order intact and
    // the invoice can be regenerated from the admin console.
    if (isCod) {
      try {
        const { InvoiceService } = await import('./invoice.service')
        await InvoiceService.createInvoiceForOrder(order.id)
      } catch (invoiceError: any) {
        logger.error(
          { error: invoiceError.message, orderId: order.id, orderNumber: order.orderNumber },
          'COD invoice generation failed (non-fatal)'
        )
      }
    }

    // Fetch order with payment record
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: true,
        payment: true,
      },
    })

    return {
      response: CheckoutService.formatOrderResponse(fullOrder!),
      isIdempotentReplay: false,
    }
  }

  /**
   * Strictly enforces the order state machine.
   * Prevents arbitrary status transitions.
   */
  public static async transitionOrderStatus(
    orderId: string,
    newStatus: OrderStatus,
    notes?: string,
    actorId?: string
  ): Promise<CheckoutResponse> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payment: true,
      },
    })

    if (!order) {
      throw new NotFoundError(`Order '${orderId}' not found`)
    }

    const currentStatus = order.status

    if (currentStatus === newStatus) {
      return CheckoutService.formatOrderResponse(order)
    }

    const allowedTransitions = VALID_ORDER_TRANSITIONS[currentStatus] || []
    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestError(
        `Invalid order status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(', ') || 'None (Terminal state)'}`
      )
    }

    const reservationItems = order.items
      .filter((i) => Boolean(i.productId))
      .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

    return await prisma.$transaction(async (tx) => {
      // Handle inventory restock/release on transition to CANCELLED
      if (newStatus === OrderStatus.CANCELLED) {
        if (currentStatus === OrderStatus.PENDING_PAYMENT) {
          // Only reserved, not deducted yet
          await InventoryService.releaseReservation(
            reservationItems,
            {
              orderId: order.id,
              orderNumber: order.orderNumber,
              actorId,
              reason: `Reservation released due to order cancellation (${currentStatus} -> CANCELLED)`,
            },
            tx
          )
        } else if (
          currentStatus === OrderStatus.CONFIRMED ||
          currentStatus === OrderStatus.PROCESSING ||
          currentStatus === OrderStatus.PACKED
        ) {
          // Stock was deducted, needs restock
          await InventoryService.restockOrder(
            reservationItems,
            {
              orderId: order.id,
              orderNumber: order.orderNumber,
              actorId,
              reason: `Order cancelled from status '${currentStatus}', restocked`,
            },
            tx
          )
        }

        // Synchronize delivery record to CANCELLED if exists
        const delivery = await tx.delivery.findUnique({
          where: { orderId: order.id },
        })
        if (delivery && delivery.status !== DeliveryStatus.CANCELLED) {
          await tx.delivery.update({
            where: { id: delivery.id },
            data: { status: DeliveryStatus.CANCELLED },
          })
          await tx.deliveryHistory.create({
            data: {
              deliveryId: delivery.id,
              status: DeliveryStatus.CANCELLED,
              actorId,
              notes: 'Delivery cancelled along with order',
            },
          })
        }
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: newStatus,
          notes: notes ? `${order.notes || ''}\n${notes}`.trim() : order.notes,
        },
        include: {
          items: true,
          payment: true,
        },
      })

      logger.info(
        { orderId, from: currentStatus, to: newStatus },
        'Order status transitioned successfully in accordance with state machine'
      )

      await AuditService.record({
        action: 'ORDER_STATUS_UPDATED',
        entity: 'Order',
        entityId: order.id,
        actorId,
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus: currentStatus,
          newStatus,
        },
        tx,
      })

      return CheckoutService.formatOrderResponse(updated)
    })
  }

  /**
   * Helper to format an Order model into a standardized API response
   */
  public static formatOrderResponse(order: any): CheckoutResponse {
    const payment = order.payment
    const shippingAddress = order.shippingAddressSnapshot as any

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      invoiceId: order.invoiceId || null,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount),
      shipping: Number(order.shipping),
      tax: Number(order.tax),
      total: Number(order.total),
      currency: order.currency || 'INR',
      couponCode: order.couponCode || null,
      shippingAddress: {
        fullName: shippingAddress?.fullName || order.customerName,
        phone: shippingAddress?.phone || order.phone,
        line1: shippingAddress?.line1 || '',
        line2: shippingAddress?.line2 || null,
        city: shippingAddress?.city || '',
        state: shippingAddress?.state || '',
        pincode: shippingAddress?.pincode || '',
        country: shippingAddress?.country || 'India',
      },
      paymentDetails: payment
        ? {
            razorpayOrderId: payment.razorpayOrderId || undefined,
            amount: Number(payment.amount),
            currency: payment.currency,
          }
        : null,
      items: (order.items || []).map((i: any) => ({
        id: i.id,
        productId: i.productId || '',
        name: i.name,
        sku: i.sku || '',
        unit: i.unit || 'piece',
        price: Number(i.price),
        quantity: i.quantity,
        subtotal: Number(i.subtotal),
      })),
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : new Date().toISOString(),
    }
  }
}
