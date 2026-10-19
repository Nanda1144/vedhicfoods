import crypto from 'crypto'
import Razorpay from 'razorpay'
import { resolveRazorpayCredentials } from './razorpay.client'
import { env } from '../../config/env'
import { logger } from '../../config/logger'
import { AppError } from '../../utils/errors'
import { ERROR_CODES, HTTP_STATUS } from '../../constants'
import { prisma } from '../../config/database'
import { AuditService } from '../../services/audit.service'
import {
  RazorpayOrderResponse,
  PaymentVerificationResponse,
  PaymentStatusResponse,
} from '../../types/payment.types'
import { OrderStatus, PaymentRecordStatus, PaymentStatus } from '@prisma/client'
import { InventoryService } from '../../services/inventory.service'
import { OrderEmailService } from '../../services/order-email.service'

export interface CapturedWebhookEntity {
  id: string
  order_id: string
  amount: number
  currency: string
  status: string
  method?: string
}

/** A captured event must contain every field needed to reconcile settlement. */
export function validateCapturedWebhookEntity(entity: unknown): asserts entity is CapturedWebhookEntity {
  if (!entity || typeof entity !== 'object') {
    throw new AppError('Invalid captured payment webhook payload', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
  }

  const value = entity as Partial<CapturedWebhookEntity>
  if (
    typeof value.id !== 'string' || !value.id.trim() ||
    typeof value.order_id !== 'string' || !value.order_id.trim() ||
    typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount <= 0 ||
    typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
    value.status !== 'captured'
  ) {
    throw new AppError('Invalid captured payment webhook payload', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
  }
}

export interface CreateRazorpayOrderParams {
  amountInPaise: number
  currency?: string
  receipt: string
  notes?: Record<string, string>
}

export interface VerifyPaymentSignatureParams {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}

export class RazorpayService {
  /**
   * Creates a Razorpay order on the payment gateway.
   * Amount is ALWAYS calculated server-side from the database. Never trusted from the frontend.
   */
  public static async createOrder(params: CreateRazorpayOrderParams, client?: Razorpay) {
    try {
      const gateway = client || (await resolveRazorpayCredentials()).client
      const order = await gateway.orders.create({
        amount: params.amountInPaise,
        currency: params.currency || 'INR',
        receipt: params.receipt,
        notes: params.notes,
      })

      logger.info(
        { razorpayOrderId: order.id, receipt: params.receipt, amount: params.amountInPaise },
        'Razorpay order created successfully'
      )
      return order
    } catch (error: any) {
      logger.error(
        { error: error?.message || error, receipt: params.receipt },
        'Failed to create Razorpay order'
      )
      throw new AppError(
        'Payment gateway is currently unavailable. Please try again.',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PAYMENT_ERROR
      )
    }
  }

  /**
   * Verifies HMAC-SHA256 signature from Razorpay using server-side secret.
   * Uses timing-safe comparison to prevent timing attacks.
   * Razorpay signature format: HMAC_SHA256(razorpayOrderId + "|" + razorpayPaymentId, keySecret)
   */
  public static verifyPaymentSignature(params: VerifyPaymentSignatureParams, secret?: string): boolean {
    try {
      const payload = `${params.razorpayOrderId}|${params.razorpayPaymentId}`
      const keySecret = secret || env.RAZORPAY_KEY_SECRET
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(payload)
        .digest('hex')

      const receivedBuf = Buffer.from(params.razorpaySignature, 'hex')
      const expectedBuf = Buffer.from(expectedSignature, 'hex')

      // Buffers must be same length for timingSafeEqual, otherwise throws
      if (receivedBuf.length !== expectedBuf.length) {
        logger.warn(
          { razorpayOrderId: params.razorpayOrderId },
          'Razorpay signature length mismatch — possible tampering attempt'
        )
        return false
      }

      const isValid = crypto.timingSafeEqual(expectedBuf, receivedBuf)

      if (!isValid) {
        logger.warn(
          { razorpayOrderId: params.razorpayOrderId },
          'Razorpay payment signature verification FAILED — invalid signature'
        )
      }

      return isValid
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Signature verification error')
      return false
    }
  }

  /**
   * Verifies webhook signature using RAZORPAY_WEBHOOK_SECRET.
   * The body must be the raw request body string (NOT parsed JSON).
   */
  public static verifyWebhookSignature(rawBody: Buffer | string, signature: string, secret?: string): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret || env.RAZORPAY_WEBHOOK_SECRET)
        // A Buffer is hashed as the exact received bytes. A string would be
        // re-encoded as UTF-8 first, which is only equivalent when the payload
        // happened to be valid UTF-8 — an assumption the signature check must not
        // depend on.
        .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
        .digest('hex')

      const receivedBuf = Buffer.from(signature, 'hex')
      const expectedBuf = Buffer.from(expectedSignature, 'hex')

      if (receivedBuf.length !== expectedBuf.length) {
        return false
      }

      return crypto.timingSafeEqual(expectedBuf, receivedBuf)
    } catch {
      return false
    }
  }

  /**
   * SECURITY: fetches the authoritative payment object from Razorpay and asserts
   * that it agrees with our own record on amount, currency and order binding.
   *
   * The checkout signature is `HMAC(order_id + "|" + payment_id, key_secret)`.
   * It proves a payment *attempt* exists and belongs to our order — it says
   * nothing about **how much** was paid. Amount is not part of the signed
   * payload, so signature verification alone cannot detect:
   *
   *   - a partial capture (Razorpay `partial_payments` / manual capture flows),
   *   - a payment that is only AUTHORIZED and was never captured,
   *   - an amount that diverges from the order total.
   *
   * `verifyAndConfirmPayment` nevertheless flipped the record to CAPTURED, marked
   * the order PAID and deducted inventory on that basis, so the ledger could
   * assert full settlement while Razorpay held a fraction of the money. That
   * discrepancy only surfaced later, in manual reconciliation.
   *
   * The gateway is the source of truth for "was this money actually received",
   * so it is queried rather than inferred.
   */
  private static async assertGatewayPaymentMatchesRecord(params: {
    razorpayPaymentId: string
    razorpayOrderId: string
    expectedAmountPaise: number
    expectedCurrency: string
    paymentRecordId: string
    orderId: string
    orderNumber: string
  }, client?: Razorpay): Promise<{ status: string; amountPaid: number }> {
    const {
      razorpayPaymentId,
      razorpayOrderId,
      expectedAmountPaise,
      expectedCurrency,
      paymentRecordId,
      orderId,
      orderNumber,
    } = params

    let gatewayPayment: any
    try {
      const gateway = client || (await resolveRazorpayCredentials()).client
      gatewayPayment = await gateway.payments.fetch(razorpayPaymentId)
    } catch (error: any) {
      logger.error(
        { error: error?.message, razorpayPaymentId, razorpayOrderId },
        'Unable to fetch payment from Razorpay — refusing to confirm'
      )
      throw new AppError(
        'Unable to verify this payment with the gateway. Please retry shortly.',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PAYMENT_ERROR
      )
    }

    const gatewayAmount = gatewayPayment?.amount
    const gatewayCurrency = String(gatewayPayment?.currency || '').toUpperCase()
    const gatewayOrderId = gatewayPayment?.order_id
    const gatewayStatus = String(gatewayPayment?.status || '').toLowerCase()
    const expectedCurrencyUpper = String(expectedCurrency || 'INR').toUpperCase()

    // Terminal states that mean money is genuinely in the account. `authorized`
    // means the funds are held but NOT settled; `failed` / `created` mean no money.
    const settledStatuses = ['captured']

    if (!settledStatuses.includes(gatewayStatus)) {
      await RazorpayService.recordSettlementAnomaly({
        action: 'PAYMENT_GATEWAY_NOT_SETTLED',
        paymentRecordId,
        orderId,
        orderNumber,
        razorpayPaymentId,
        razorpayOrderId,
        gatewayStatus,
        gatewayAmount,
        expectedAmountPaise,
      })

      throw new AppError(
        `Payment is not settled with the gateway (status: ${gatewayStatus || 'unknown'}). ` +
          'If you were charged, contact support with your payment reference.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PAYMENT_ERROR
      )
    }

    if (gatewayOrderId && gatewayOrderId !== razorpayOrderId) {
      await RazorpayService.recordSettlementAnomaly({
        action: 'PAYMENT_GATEWAY_ORDER_MISMATCH',
        paymentRecordId,
        orderId,
        orderNumber,
        razorpayPaymentId,
        razorpayOrderId,
        gatewayOrderId,
        gatewayAmount,
        expectedAmountPaise,
      })

      throw new AppError(
        'Payment verification failed: the payment is not linked to this order. This incident has been logged.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PAYMENT_ERROR
      )
    }

    const amountMismatch = Number(gatewayAmount) !== Number(expectedAmountPaise)
    const currencyMismatch = gatewayCurrency !== expectedCurrencyUpper

    if (amountMismatch || currencyMismatch) {
      await RazorpayService.recordSettlementAnomaly({
        action: amountMismatch ? 'PAYMENT_GATEWAY_AMOUNT_MISMATCH' : 'PAYMENT_GATEWAY_CURRENCY_MISMATCH',
        paymentRecordId,
        orderId,
        orderNumber,
        razorpayPaymentId,
        razorpayOrderId,
        gatewayAmount,
        gatewayCurrency,
        expectedAmountPaise,
        expectedCurrency: expectedCurrencyUpper,
      })

      logger.error(
        {
          razorpayPaymentId,
          razorpayOrderId,
          gatewayAmount,
          expectedAmountPaise,
          gatewayCurrency,
          expectedCurrency,
        },
        'Razorpay settlement does not match the recorded amount — payment rejected'
      )

      throw new AppError(
        'Payment verification failed: the amount received does not match the order total. ' +
          'This incident has been logged.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PAYMENT_ERROR
      )
    }

    return { status: gatewayStatus, amountPaid: Number(gatewayAmount) }
  }

  /**
   * Records a reconciliation anomaly. These are the events the finance team needs
   * to see in the audit trail, so they are logged explicitly rather than
   * swallowed by the throw path above.
   */
  private static async recordSettlementAnomaly(metadata: Record<string, unknown>): Promise<void> {
    try {
      await AuditService.record({
        action: String(metadata.action),
        entity: 'Payment',
        entityId: String(metadata.paymentRecordId ?? ''),
        metadata,
      })
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Failed to record payment settlement anomaly')
    }
  }

  /**
   * Initiates a Razorpay payment session for an existing Vedhic Foods order.
   * The order must be in PENDING_PAYMENT state.
   * Amount and currency are ALWAYS sourced from the database — NEVER from the frontend request.
   *
   * Returns all data needed by the frontend to open Razorpay checkout SDK.
   */
  public static async initiatePayment(
    internalOrderId: string,
    userId: string
  ): Promise<RazorpayOrderResponse> {
    // 1. Fetch the authoritative order from database — this is the single source of truth
    const order = await prisma.order.findUnique({
      where: { id: internalOrderId },
      include: {
        payment: true,
        user: { select: { fullName: true, email: true, phone: true } },
      },
    })

    if (!order) {
      throw new AppError('Order not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    // 2. Strict ownership check — cannot initiate payment for someone else's order
    if (order.userId !== userId) {
      throw new AppError(
        'You are not authorized to initiate payment for this order',
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.FORBIDDEN
      )
    }

    // 3. Validate order is in the correct state for payment
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new AppError(
        `Payment cannot be initiated. Order is in '${order.status}' status, not PENDING_PAYMENT.`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    if (order.paymentMethod === 'COD') {
      throw new AppError(
        'This order is configured for Cash on Delivery. Online payment is not applicable.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    // 4. Resolve the active gateway credentials (admin dashboard first, env fallback).
    //    The public key id is returned to the storefront; secrets are never exposed.
    const session = await resolveRazorpayCredentials()

    // 4. If a Razorpay order already exists for this internal order, return it directly
    //    This supports idempotent re-initialization (e.g., user refreshes page)
    if (order.payment?.razorpayOrderId && order.payment.status === PaymentRecordStatus.PENDING) {
      logger.info(
        { orderId: internalOrderId, razorpayOrderId: order.payment.razorpayOrderId },
        'Returning existing Razorpay order (idempotent replay)'
      )

      const snapshotPhone =
        (order.shippingAddressSnapshot as any)?.phone || order.phone || order.user?.phone || ''

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        razorpayOrderId: order.payment.razorpayOrderId,
        amountInPaise: Math.round(Number(order.total) * 100),
        currency: order.currency || 'INR',
        keyId: session.keyId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: snapshotPhone,
        description: `Payment for Vedhic Foods order ${order.orderNumber}`,
      }
    }

    // 5. Calculate authoritative amount in paise — NEVER trusting frontend amounts
    const totalRupees = Number(order.total)
    if (totalRupees <= 0) {
      throw new AppError(
        'Invalid order total. Cannot create payment for zero or negative amount.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }
    const amountInPaise = Math.round(totalRupees * 100)

    // 6. Create Razorpay order through payment gateway SDK
    const razorpayOrder = await RazorpayService.createOrder({
      amountInPaise,
      currency: order.currency || 'INR',
      receipt: order.orderNumber, // Human-readable receipt for Razorpay dashboard
      notes: {
        orderNumber: order.orderNumber,
        customerId: order.userId,
        customerEmail: order.customerEmail,
        platform: 'vedhicfoods',
      },
    }, session.client)

    // 7. Atomically update the Payment record with the real Razorpay order ID
    await prisma.payment.update({
      where: { orderId: order.id },
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: totalRupees,
        currency: order.currency || 'INR',
        status: PaymentRecordStatus.PENDING,
        metadata: {
          razorpayOrderCreatedAt: new Date().toISOString(),
          amountInPaise,
          receipt: order.orderNumber,
        },
      },
    })

    const snapshotPhone =
      (order.shippingAddressSnapshot as any)?.phone || order.phone || order.user?.phone || ''

    try {
      await AuditService.record({
        action: 'PAYMENT_INITIATED',
        entity: 'Payment',
        entityId: order.payment?.id || '',
        actorId: userId,
        actorEmail: order.user?.email,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          razorpayOrderId: razorpayOrder.id,
          amountInPaise,
          currency: order.currency || 'INR',
        },
      })
    } catch (error: any) {
      logger.error({ error: error?.message, orderId: order.id }, 'Failed to record payment initiation audit')
    }

    logger.info(
      { orderId: internalOrderId, razorpayOrderId: razorpayOrder.id, amountInPaise },
      'Razorpay payment initiated for order'
    )

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      razorpayOrderId: razorpayOrder.id,
      amountInPaise,
      currency: order.currency || 'INR',
      keyId: session.keyId, // Public key — safe for frontend
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: snapshotPhone,
      description: `Payment for Vedhic Foods order ${order.orderNumber}`,
    }
  }

  /**
   * Verifies Razorpay payment signature and processes confirmed payment.
   * This is the AUTHORITATIVE confirmation path triggered by the frontend after payment.
   *
   * Security:
   * - Signature is verified with HMAC-SHA256 using server-side key secret
   * - Amount is cross-validated against the database (never trusting frontend amounts)
   * - Duplicate payment prevention via idempotency checks
   * - Complete audit trail recorded
   */
  public static async verifyAndConfirmPayment(
    params: {
      razorpayOrderId: string
      razorpayPaymentId: string
      razorpaySignature: string
    },
    userId: string,
    actorEmail?: string
  ): Promise<PaymentVerificationResponse> {
    // 1. Find the payment record by Razorpay order ID
    const paymentRecord = await prisma.payment.findUnique({
      where: { razorpayOrderId: params.razorpayOrderId },
      include: {
        order: {
          include: {
            items: { where: { productId: { not: null } } },
          },
        },
      },
    })

    if (!paymentRecord) {
      throw new AppError(
        `Payment record not found for Razorpay order '${params.razorpayOrderId}'`,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      )
    }

    // 2. Ownership validation
    if (paymentRecord.order.userId !== userId) {
      throw new AppError(
        'You are not authorized to verify payment for this order',
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.FORBIDDEN
      )
    }

    // 3. Idempotency: If already verified and captured, return success without reprocessing
    if (paymentRecord.status === PaymentRecordStatus.CAPTURED && paymentRecord.razorpayPaymentId) {
      logger.info(
        { razorpayOrderId: params.razorpayOrderId, paymentId: paymentRecord.razorpayPaymentId },
        'Payment already verified (idempotent replay)'
      )
      return {
        success: true,
        message: 'Payment already confirmed',
        orderId: paymentRecord.order.id,
        orderNumber: paymentRecord.order.orderNumber,
        paymentId: paymentRecord.razorpayPaymentId,
        status: 'CAPTURED',
        verifiedAt: paymentRecord.verifiedAt?.toISOString() || new Date().toISOString(),
      }
    }

    // 4. Reject duplicate payment ID
    if (params.razorpayPaymentId && paymentRecord.razorpayPaymentId &&
        paymentRecord.razorpayPaymentId !== params.razorpayPaymentId) {
      throw new AppError(
        'Payment ID mismatch. Duplicate or conflicting payment attempt detected.',
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CONFLICT
      )
    }

    // 5. CRITICAL: Verify HMAC-SHA256 signature (NEVER skip this)
    //    The key secret is resolved from the admin-configured credentials first,
    //    falling back to the environment.
    const session = await resolveRazorpayCredentials()
    const isSignatureValid = RazorpayService.verifyPaymentSignature({
      razorpayOrderId: params.razorpayOrderId,
      razorpayPaymentId: params.razorpayPaymentId,
      razorpaySignature: params.razorpaySignature,
    }, session.keySecret)

    if (!isSignatureValid) {
      // Log as a security event and fail the payment
      await AuditService.record({
        actorId: userId,
        actorEmail,
        action: 'PAYMENT_SIGNATURE_INVALID',
        entity: 'Payment',
        entityId: paymentRecord.id,
        metadata: {
          razorpayOrderId: params.razorpayOrderId,
          razorpayPaymentId: params.razorpayPaymentId,
          reason: 'HMAC-SHA256 signature mismatch',
        },
      })

      await prisma.payment.update({
        where: { id: paymentRecord.id },
        data: {
          status: PaymentRecordStatus.FAILED,
          failureCode: 'SIGNATURE_INVALID',
          failureReason: 'Razorpay payment signature verification failed',
        },
      })

      throw new AppError(
        'Payment verification failed: Invalid signature. This incident has been logged.',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    const verifiedAt = new Date()

    // 5b. SECURITY: confirm with the gateway that the money actually arrived,
    // and for the exact recorded amount. The signature above proves only that a
    // payment attempt belongs to this order — it binds neither the amount nor
    // the capture status. Without this call a partial or merely AUTHORIZED
    // payment could be recorded as CAPTURED and the order marked PAID.
    const settlement = await RazorpayService.assertGatewayPaymentMatchesRecord({
      razorpayPaymentId: params.razorpayPaymentId,
      razorpayOrderId: params.razorpayOrderId,
      expectedAmountPaise: Math.round(Number(paymentRecord.amount) * 100),
      expectedCurrency: paymentRecord.currency || 'INR',
      paymentRecordId: paymentRecord.id,
      orderId: paymentRecord.orderId,
      orderNumber: paymentRecord.order.orderNumber,
    }, session.client)

    // 6. Atomically confirm payment and trigger inventory deduction inside a transaction
    const result = await prisma.$transaction(async (tx) => {
      // SECURITY: the idempotency check at step 3 reads payment.status *outside*
      // a transaction. A `payment.captured` webhook or a parallel verify request
      // can observe the same pre-CAPTURED value, and both transact. The inventory
      // deduction is guarded only by per-row FOR UPDATE locks — which serialize,
      // but do not prevent, a second deduction — so a race inflated sales
      // quantities and emitted duplicate inventory/invoice records. An updateMany
      // scoped to non-CAPTURED rows is an atomic compare-and-set: exactly one
      // caller transitions the record and the loser matches zero rows, aborts
      // here, and never re-deducts.
      const gate = await tx.payment.updateMany({
        where: { id: paymentRecord.id, status: { not: PaymentRecordStatus.CAPTURED } },
        data: {
          razorpayPaymentId: params.razorpayPaymentId,
          razorpaySignature: params.razorpaySignature,
          status: PaymentRecordStatus.CAPTURED,
          verifiedAt,
          metadata: {
            ...(paymentRecord.metadata as object),
            verifiedAt: verifiedAt.toISOString(),
            verificationMethod: 'signature',
          },
        },
      })

      if (gate.count === 0) {
        return { alreadyCaptured: true } as const
      }

      // Update Order: PENDING_PAYMENT → CONFIRMED, paymentStatus → PAID
      const updatedOrder = await tx.order.update({
        where: { id: paymentRecord.orderId },
        data: {
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
        },
      })

      // Deduct inventory: reserved stock is now fully sold
      const inventoryItems = paymentRecord.order.items
        .filter((i) => Boolean(i.productId))
        .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

      if (inventoryItems.length > 0) {
        await InventoryService.confirmDeduction(
          inventoryItems,
          {
            orderId: paymentRecord.orderId,
            orderNumber: paymentRecord.order.orderNumber,
            actorId: userId,
            actorEmail,
            reason: `Online payment confirmed via Razorpay (pay_id: ${params.razorpayPaymentId})`,
          },
          tx
        )
      }

      return { alreadyCaptured: false, updatedOrder }
    }, { timeout: 30000, maxWait: 20000 })

    if (result.alreadyCaptured) {
      logger.info(
        { razorpayOrderId: params.razorpayOrderId, paymentId: paymentRecord.razorpayPaymentId },
        'Payment capture raced with a concurrent confirmation — treated as idempotent'
      )
      return {
        success: true,
        message: 'Payment already confirmed',
        orderId: paymentRecord.orderId,
        orderNumber: paymentRecord.order.orderNumber,
        paymentId: paymentRecord.razorpayPaymentId || params.razorpayPaymentId,
        status: 'CAPTURED',
        verifiedAt: paymentRecord.verifiedAt?.toISOString() || new Date().toISOString(),
      }
    }

    // 7. Audit trail: payment confirmed
    await AuditService.record({
      actorId: userId,
      actorEmail,
      action: 'PAYMENT_CONFIRMED',
      entity: 'Payment',
      entityId: paymentRecord.id,
      metadata: {
        orderId: paymentRecord.orderId,
        orderNumber: paymentRecord.order.orderNumber,
        razorpayOrderId: params.razorpayOrderId,
        razorpayPaymentId: params.razorpayPaymentId,
        amount: Number(paymentRecord.amount),
        currency: paymentRecord.currency,
        verifiedAt: verifiedAt.toISOString(),
        gatewayStatus: settlement.status,
        gatewayAmount: settlement.amountPaid,
      },
    })

    logger.info(
      {
        orderId: paymentRecord.orderId,
        orderNumber: paymentRecord.order.orderNumber,
        razorpayPaymentId: params.razorpayPaymentId,
        amount: Number(paymentRecord.amount),
      },
      'Razorpay payment verified and order confirmed'
    )

    // Generate the tax invoice and email it to the customer + a printable copy to
    // admin. Best-effort: a mail/PDF failure must never roll back a captured payment.
    await RazorpayService.emitInvoice(paymentRecord.orderId)

    // Customer payment confirmation + operations alert. Deduped so the
    // independent `payment.captured` webhook cannot send them a second time.
    await OrderEmailService.paymentConfirmed(paymentRecord.orderId, `payment_confirmed:${paymentRecord.orderId}`)
    await OrderEmailService.notifyAdminPaidOrder(paymentRecord.orderId, `admin_paid_order:${paymentRecord.orderId}`)

    return {
      success: true,
      message: `Payment of ₹${Number(paymentRecord.amount).toFixed(2)} verified and order ${paymentRecord.order.orderNumber} confirmed`,
      orderId: paymentRecord.orderId,
      orderNumber: paymentRecord.order.orderNumber,
      paymentId: params.razorpayPaymentId,
      status: 'CAPTURED',
      verifiedAt: verifiedAt.toISOString(),
    }
  }

  /**
   * Processes Razorpay webhook events independently.
   * Webhooks are the SECONDARY confirmation path — they are independent of the frontend flow.
   * This handles: payment.captured, payment.failed, order.paid
   */
  public static async processWebhookEvent(
    rawBody: Buffer | string,
    signature: string
  ): Promise<{ processed: boolean; event: string }> {
    // 1. Verify webhook signature over the exact bytes received.
    //    The webhook secret is resolved from the admin-configured credentials first,
    //    falling back to the environment.
    const session = await resolveRazorpayCredentials()
    if (!RazorpayService.verifyWebhookSignature(rawBody, signature, session.webhookSecret)) {
      logger.warn('Razorpay webhook signature verification failed — rejecting webhook')
      throw new AppError(
        'Webhook signature verification failed',
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED
      )
    }

    let payload: any
    try {
      // Parse from the bytes that were just verified. Never from a re-serialised
      // object, which would be a second, unverified representation of the body.
      payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody)
    } catch {
      throw new AppError('Invalid webhook payload', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.BAD_REQUEST)
    }

    const event: string = payload.event || 'unknown'
    const paymentEntity = payload?.payload?.payment?.entity

    logger.info({ event, paymentId: paymentEntity?.id }, 'Razorpay webhook received')

    switch (event) {
      case 'payment.captured':
        validateCapturedWebhookEntity(paymentEntity)
        await RazorpayService.handlePaymentCaptured(paymentEntity)
        break

      case 'payment.failed':
        await RazorpayService.handlePaymentFailed(paymentEntity)
        break

      case 'order.paid':
        // order.paid fires after payment.captured — treat idempotently
        logger.info({ razorpayOrderId: paymentEntity?.order_id }, 'Webhook: order.paid received (idempotent)')
        break

      default:
        logger.info({ event }, 'Razorpay webhook event received but not handled')
    }

    return { processed: true, event }
  }

  /**
   * Handles payment.captured webhook — the Razorpay server independently confirmed payment.
   * Idempotent: safe to call multiple times with same payload.
   */
  private static async handlePaymentCaptured(entity: any): Promise<void> {
    if (!entity?.order_id || !entity?.id) {
      logger.warn({ entity }, 'Webhook payment.captured missing order_id or payment id')
      return
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId: entity.order_id },
      include: {
        order: {
          include: {
            items: { where: { productId: { not: null } } },
          },
        },
      },
    })

    if (!payment) {
      logger.warn({ razorpayOrderId: entity.order_id }, 'Webhook: payment record not found')
      return
    }

    // Idempotency: if already CAPTURED, skip
    if (payment.status === PaymentRecordStatus.CAPTURED) {
      logger.info(
        { razorpayOrderId: entity.order_id },
        'Webhook: payment.captured idempotent — already captured'
      )
      return
    }

    const verifiedAt = new Date()

    // SECURITY: the webhook payload is signed by Razorpay, so `entity.amount` is
    // authentic as to what the gateway reports — but it was never compared to
    // what we recorded. A partial capture therefore confirmed the order and
    // deducted inventory for a fraction of the amount owed. Compare before
    // mutating any state.
    const gatewayAmount = Number(entity.amount)
    const recordedAmount = Number(payment.amount)
    const recordedAmountPaise = Math.round(recordedAmount * 100)

    if (gatewayAmount !== recordedAmountPaise) {
      await RazorpayService.recordSettlementAnomaly({
        action: 'PAYMENT_GATEWAY_AMOUNT_MISMATCH',
        paymentRecordId: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        razorpayPaymentId: entity.id,
        razorpayOrderId: entity.order_id,
        gatewayAmount: entity.amount,
        gatewayCurrency: entity.currency,
        expectedAmountPaise: recordedAmountPaise,
        expectedCurrency: payment.currency,
        source: 'razorpay_webhook',
      })

      logger.error(
        {
          razorpayOrderId: entity.order_id,
          gatewayAmount: entity.amount,
          recordedAmountPaise,
        },
        'payment.captured amount does not match the recorded amount — order left unconfirmed for manual review'
      )
      return
    }

    const gatewayCurrency = String(entity.currency || '').toUpperCase()
    const recordedCurrency = String(payment.currency || 'INR').toUpperCase()

    if (gatewayCurrency !== recordedCurrency) {
      await RazorpayService.recordSettlementAnomaly({
        action: 'PAYMENT_GATEWAY_CURRENCY_MISMATCH',
        paymentRecordId: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        razorpayPaymentId: entity.id,
        razorpayOrderId: entity.order_id,
        gatewayAmount: entity.amount,
        gatewayCurrency: entity.currency,
        expectedAmountPaise: recordedAmountPaise,
        expectedCurrency: recordedCurrency,
        source: 'razorpay_webhook',
      })

      logger.error(
        { razorpayOrderId: entity.order_id, gatewayCurrency, recordedCurrency },
        'payment.captured currency mismatch — order left unconfirmed for manual review'
      )
      return
    }

    const captured = await prisma.$transaction(async (tx) => {
      // SECURITY: same atomic compare-and-set gate as the verify path. The
      // pre-check above reads `payment.status` outside this transaction; a
      // concurrent client-side verification can already be committing its own
      // CAPTURED transition. Without the gate both flows deduct inventory for
      // the same sale. Exactly one caller wins the conditional update; the
      // loser aborts and leaves the winner's state untouched.
      const gate = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: PaymentRecordStatus.CAPTURED } },
        data: {
          razorpayPaymentId: entity.id,
          status: PaymentRecordStatus.CAPTURED,
          verifiedAt,
          metadata: {
            ...(payment.metadata as object),
            webhookCapturedAt: verifiedAt.toISOString(),
            webhookPaymentMethod: entity.method,
          },
        },
      })

      if (gate.count === 0) return false

      // Only update order if still in PENDING_PAYMENT state
      if (payment.order.status === OrderStatus.PENDING_PAYMENT) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: {
            status: OrderStatus.CONFIRMED,
            paymentStatus: PaymentStatus.PAID,
          },
        })

        // Deduct inventory via webhook if not already deducted by client-side verification
        const inventoryItems = payment.order.items
          .filter((i) => Boolean(i.productId))
          .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

        if (inventoryItems.length > 0) {
          await InventoryService.confirmDeduction(
            inventoryItems,
            {
              orderId: payment.orderId,
              orderNumber: payment.order.orderNumber,
              reason: `Razorpay webhook payment.captured (pay_id: ${entity.id})`,
            },
            tx
          )
        }
      }

      return true
    }, { timeout: 30000, maxWait: 20000 })

    if (!captured) {
      logger.info(
        { razorpayOrderId: entity.order_id, paymentId: entity.id },
        'Webhook: payment.captured raced with an existing capture — skipped as idempotent'
      )
      return
    }

    await AuditService.record({
      action: 'PAYMENT_CONFIRMED',
      entity: 'Payment',
      entityId: payment.id,
      metadata: {
        source: 'razorpay_webhook',
        event: 'payment.captured',
        razorpayPaymentId: entity.id,
        razorpayOrderId: entity.order_id,
        amount: entity.amount,
        currency: entity.currency,
      },
    })

    logger.info(
      { razorpayOrderId: entity.order_id, paymentId: entity.id },
      'Webhook: payment.captured processed successfully'
    )

    // Secondary confirmation path must also emit the invoice, so a payment
    // confirmed solely by webhook (frontend never called back) still produces
    // the customer + admin tax invoice. Idempotent and best-effort.
    await RazorpayService.emitInvoice(payment.orderId)

    // Payment confirmation + admin alert. Deduped against the verify path by
    // the shared idempotency keys, so a dual-confirmed capture mails once.
    await OrderEmailService.paymentConfirmed(payment.orderId, `payment_confirmed:${payment.orderId}`)
    await OrderEmailService.notifyAdminPaidOrder(payment.orderId, `admin_paid_order:${payment.orderId}`)
  }

  /**
   * Handles payment.failed webhook — Razorpay independently reports a failed payment.
   * Releases inventory reservation so the stock becomes available again.
   */
  private static async handlePaymentFailed(entity: any): Promise<void> {
    if (!entity?.order_id) {
      logger.warn({ entity }, 'Webhook payment.failed missing order_id')
      return
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId: entity.order_id },
      include: {
        order: {
          include: {
            items: { where: { productId: { not: null } } },
          },
        },
      },
    })

    if (!payment) {
      logger.warn({ razorpayOrderId: entity.order_id }, 'Webhook: payment.failed — record not found')
      return
    }

    // SECURITY: `payment.failed` is emitted for *any* failed attempt on a
    // Razorpay order, not just the final one. Razorpay also retries deliveries,
    // so a failure event for attempt #1 can arrive after — or be delivered
    // alongside — the `payment.captured` event for attempt #2.
    //
    // The previous guard was `if (payment.status === FAILED) return`, which a
    // CAPTURED payment does not satisfy. A late failure event therefore
    // downgraded a captured payment to FAILED, flipped the order to
    // PAYMENT_FAILED, and released the inventory reservation — so stock that
    // had already been sold became available for resale while the customer's
    // money was banked. Revenue loss plus a corrupted fulfilment queue.
    //
    // CAPTURED is a terminal success state: once money is captured, no failure
    // event may degrade it. The same applies to an order already marked paid.
    if (payment.status === PaymentRecordStatus.CAPTURED) {
      logger.warn(
        { razorpayOrderId: entity.order_id, razorpayPaymentId: entity.id },
        'Webhook: payment.failed ignored — payment is already captured (out-of-order delivery)'
      )
      return
    }

    if (payment.order.paymentStatus === PaymentStatus.PAID) {
      logger.warn(
        { razorpayOrderId: entity.order_id },
        'Webhook: payment.failed ignored — order is already marked PAID'
      )
      return
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentRecordStatus.FAILED,
          failureCode: entity.error_code || 'PAYMENT_FAILED',
          failureReason: entity.error_description || 'Payment failed via Razorpay',
          metadata: {
            ...(payment.metadata as object),
            failedAt: new Date().toISOString(),
            errorCode: entity.error_code,
            errorDescription: entity.error_description,
          },
        },
      })

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: OrderStatus.PAYMENT_FAILED,
          paymentStatus: PaymentStatus.FAILED,
        },
      })

      // Release inventory reservation — order did not complete
      const inventoryItems = payment.order.items
        .filter((i) => Boolean(i.productId))
        .map((i) => ({ productId: i.productId!, quantity: i.quantity }))

      if (inventoryItems.length > 0) {
        await InventoryService.releaseReservation(
          inventoryItems,
          {
            orderId: payment.orderId,
            orderNumber: payment.order.orderNumber,
            reason: `Razorpay webhook payment.failed: ${entity.error_description || 'payment failed'}`,
          },
          tx
        )
      }
    })

    await AuditService.record({
      action: 'PAYMENT_FAILED',
      entity: 'Payment',
      entityId: payment.id,
      metadata: {
        source: 'razorpay_webhook',
        event: 'payment.failed',
        razorpayOrderId: entity.order_id,
        errorCode: entity.error_code,
        errorDescription: entity.error_description,
      },
    })

    logger.info(
      { razorpayOrderId: entity.order_id, errorCode: entity.error_code },
      'Webhook: payment.failed processed — inventory released'
    )

    // Customer payment-failure notice. Deduped so repeated failure events on the
    // same Razorpay order (one per attempt) do not spam the customer.
    await OrderEmailService.paymentFailed(
      payment.orderId,
      entity.error_description || 'Payment failed',
      `payment_failed:${payment.orderId}`
    )
  }

  /**
   * Post-payment side effect: create the tax invoice (PDF) and dispatch it to the
   * customer and to the admin as a printable confirmation copy.
   *
   * Deliberately non-fatal and idempotent. Payment capture is authoritative and
   * must not fail because PDF rendering, S3 upload or mail delivery hiccuped; the
   * invoice can always be regenerated from the paid order. The dynamic import
   * keeps the invoice/email/PDF dependency out of the request bootstrap path.
   */
  private static async emitInvoice(orderId: string): Promise<void> {
    try {
      const { InvoiceService } = await import('../../services/invoice.service')
      await InvoiceService.createInvoiceForOrder(orderId)
    } catch (error: any) {
      logger.error(
        { error: error?.message, orderId },
        'Invoice generation after payment capture failed (non-fatal)'
      )
    }
  }

  /**
   * Issues a (full or partial) refund through Razorpay and notifies the customer.
   *
   * Only a CAPTURED payment on a known Razorpay payment id can be refunded.
   * The recovered amount and its status come from the gateway response, never
   * from the caller, so an admin cannot fabricate a refund that never happened.
   * Refunds are idempotent at the gateway and this wrapper additionally refuses
   * to refund a payment whose record is already REFUNDED.
   */
  public static async refundPayment(params: {
    orderId?: string
    razorpayPaymentId?: string
    /** Amount in rupees. Omit to refund the full recorded amount. */
    amount?: number
    reason?: string
    actorId?: string
    actorEmail?: string
  }): Promise<{ orderId: string; orderNumber: string; refundId: string; amount: number; status: string }> {
    const session = await resolveRazorpayCredentials()

    const payment = await prisma.payment.findFirst({
      where: params.razorpayPaymentId
        ? { razorpayPaymentId: params.razorpayPaymentId }
        : { orderId: params.orderId! },
      include: { order: true },
    })

    if (!payment) {
      throw new AppError('Payment record not found for refund', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    if (payment.status !== PaymentRecordStatus.CAPTURED) {
      throw new AppError(
        `Only captured payments can be refunded (current status: ${payment.status})`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    if (!payment.razorpayPaymentId) {
      throw new AppError(
        'Payment has no Razorpay payment id and cannot be refunded',
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST
      )
    }

    const recordedAmount = Number(payment.amount)
    const refundRupees = params.amount ?? recordedAmount

    if (!Number.isFinite(refundRupees) || refundRupees <= 0) {
      throw new AppError('Refund amount must be greater than zero', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR)
    }

    if (refundRupees > recordedAmount + 0.001) {
      throw new AppError(
        `Refund amount (${refundRupees}) exceeds the captured amount (${recordedAmount})`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      )
    }

    const refundPaise = Math.round(refundRupees * 100)
    const recordedPaise = Math.round(recordedAmount * 100)
    const isFullRefund = refundPaise >= recordedPaise

    let gatewayRefund: any
    try {
      gatewayRefund = await (session.client.payments as any).refund(payment.razorpayPaymentId, {
        amount: refundPaise,
        speed: 'normal',
        notes: {
          reason: params.reason || 'Customer refund',
          orderNumber: payment.order.orderNumber,
        },
      })
    } catch (error: any) {
      logger.error(
        { error: error?.message, razorpayPaymentId: payment.razorpayPaymentId },
        'Razorpay refund call failed'
      )
      throw new AppError(
        'Refund could not be processed by the payment gateway',
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_SERVER_ERROR
      )
    }

    const refundId: string = gatewayRefund?.id || 'refund'
    const refundStatus: string = gatewayRefund?.status || 'processed'
    const refundedAt = new Date()

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: isFullRefund ? PaymentRecordStatus.REFUNDED : PaymentRecordStatus.CAPTURED,
          metadata: {
            ...(payment.metadata as object),
            refundId,
            refundAmount: refundRupees,
            refundStatus,
            refundedAt: refundedAt.toISOString(),
            refundReason: params.reason || null,
          },
        },
      })

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        },
      })
    }, { timeout: 20000, maxWait: 15000 })

    await AuditService.record({
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: 'PAYMENT_REFUNDED',
      entity: 'Payment',
      entityId: payment.id,
      metadata: {
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        refundId,
        refundAmount: refundRupees,
        fullRefund: isFullRefund,
        gatewayStatus: refundStatus,
      },
    })

    logger.info(
      { orderId: payment.orderId, refundId, refundAmount: refundRupees, isFullRefund },
      'Razorpay refund processed'
    )

    await OrderEmailService.refundProcessed(
      payment.orderId,
      { refundId, amount: refundRupees, status: 'processed' },
      `refund:${payment.orderId}:${refundId}`
    )

    return {
      orderId: payment.orderId,
      orderNumber: payment.order.orderNumber,
      refundId,
      amount: refundRupees,
      status: refundStatus,
    }
  }

  /**
   * Returns the authoritative payment status for an order from the database.
   * Never calls Razorpay API here — DB is the ground truth after verification.
   */
  public static async getPaymentStatus(
    orderId: string,
    userId: string
  ): Promise<PaymentStatusResponse> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true },
    })

    if (!order) {
      throw new AppError('Order not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    if (order.userId !== userId) {
      throw new AppError(
        'You are not authorized to view payment status for this order',
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.FORBIDDEN
      )
    }

    const payment = order.payment

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      amount: Number(order.total),
      currency: order.currency || 'INR',
      razorpayOrderId: payment?.razorpayOrderId || null,
      razorpayPaymentId: payment?.razorpayPaymentId || null,
      verifiedAt: payment?.verifiedAt?.toISOString() || null,
      failureCode: payment?.failureCode || null,
      failureReason: payment?.failureReason || null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    }
  }
}
