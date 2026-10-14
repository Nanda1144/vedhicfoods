import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AppError } from '../utils/errors'
import { HTTP_STATUS, ERROR_CODES } from '../constants'
import { razorpayClient } from '../integrations/razorpay/razorpay.client'
import { PaymentStatus, PaymentRecordStatus, InvoiceStatus } from '@prisma/client'

export interface ReconciliationParams {
  from?: Date
  to?: Date
  status?: PaymentRecordStatus
}

export interface ReconciliationReport {
  reconciled: number
  mismatches: MismatchReport[]
  missingInRazorpay: number
  missingInLocal: number
  totalLocalPayments: number
  totalRazorpayPayments: number
  generatedAt: string
}

export interface MismatchReport {
  localPaymentId: string
  razorpayOrderId?: string
  localPaymentIdRef?: string
  amountLocal: number
  amountRazorpay?: number
  statusLocal: PaymentRecordStatus
  statusRazorpay?: string
  mismatchType: 'amount' | 'status' | 'missing_remote' | 'missing_local'
  description: string
  resolutionSuggested: string
  createdAt: Date
}

/** A payment as Razorpay reports it, already converted to local units. */
export interface RemotePaymentRecord {
  razorpayOrderId: string
  paymentId: string
  /** Rupees, to match `Payment.amount`. Razorpay returns paise. */
  amount: number
  currency: string
  status: string
}

/**
 * Reconciles local payment records against Razorpay's payment records.
 * 
 * This service compares:
 * 1. All payment records in the local database with a Razorpay order
 * 2. All payments from Razorpay's API for the same date range
 * 3. Flags mismatches in amount, status, or missing records
 * 
 * Recommended usage: run daily as a cron job / scheduled task
 */
/**
 * Upper bound on rows any single reconciliation query may load.
 *
 * These reports cross-join local rows against rows fetched from Razorpay, so
 * cost grows with the size of the window. Without a cap, a wide date range (or
 * no range at all, which one of these queries used to do) loads the entire
 * history into the Node heap. Real reconciliation should be chunked or moved to
 * a background job; until then this bounds the damage.
 */
const RECONCILIATION_MAX_ROWS = 5000

/**
 * `GET /v1/payments` returns at most 100 payments per request; anything larger
 * is silently clamped by Razorpay, so paging has to happen here.
 */
const RAZORPAY_PAGE_SIZE = 100

/**
 * Wall-clock budget for the whole remote fetch.
 *
 * The Razorpay SDK issues its request with no timeout, so a stalled gateway
 * would otherwise hang the reconciliation request indefinitely - the same
 * failure mode as the rate-limiter Redis commands. Bounded here instead.
 */
const REMOTE_FETCH_BUDGET_MS = 30_000

export class ReconciliationService {
  /**
   * Reconciles payments between local database and Razorpay for a given date range.
   */
  public static async reconcilePayments(params: ReconciliationParams): Promise<ReconciliationReport> {
    const {
      from = new Date(new Date().setMonth(new Date().getMonth() - 1)),
      to = new Date(),
    } = params

    // 1. Fetch all local payments in range with Razorpay IDs
    // PERFORMANCE: this read was completely unbounded. The default window is one
    // month, but a caller can pass any range and every matching payment — each
    // with its order — was loaded into memory and then cross-joined against the
    // remote set. Capped so a single request cannot exhaust the heap.
    const localPayments = await prisma.payment.findMany({
      where: {
        createdAt: {
          gte: from,
          lte: to,
        },
        razorpayOrderId: {
          not: null,
        },
        ...(params.status ? { status: params.status } : {}),
      },
      take: RECONCILIATION_MAX_ROWS,
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            total: true,
            paymentStatus: true,
            status: true,
          },
        },
      },
    })

    // 2. Reconciliation is done server-side — remote records come from Razorpay's
    //    payments endpoint (GET /v1/payments), filtered by the same date window.
    const remotePayments = await this.fetchRemotePayments(from, to)

    // 3. Index local payments by razorpayOrderId
    const localIndex = new Map(
      localPayments.map((p) => [p.razorpayOrderId!, { payment: p, invoice: undefined }])
    )

    const mismatches: MismatchReport[] = []

    // 4. Compare each remote payment against local
    for (const remote of remotePayments) {
      const localEntry = localIndex.get(remote.razorpayOrderId)

      if (!localEntry) {
        // Remote payment exists but not in local DB — critical mismatch
        mismatches.push({
          localPaymentId: 'N/A',
          razorpayOrderId: remote.razorpayOrderId,
          localPaymentIdRef: remote.paymentId,
          amountLocal: 0,
          amountRazorpay: remote.amount,
          statusLocal: PaymentRecordStatus.PENDING, // Default fallback
          statusRazorpay: remote.status,
          mismatchType: 'missing_local',
          description: `Remote payment ${remote.paymentId} (${remote.status}, ${remote.currency} ${remote.amount}) not found in local database`,
          resolutionSuggested: 'Manually create payment record or investigate webhook delivery failure',
          createdAt: new Date(),
        })
        continue
      }

      const local = localEntry.payment

      // 5. Amount reconciliation
      const amountMismatch = this.roundAmount(Number(local.amount)) !== this.roundAmount(remote.amount)
      if (amountMismatch) {
        mismatches.push({
          localPaymentId: local.id,
          razorpayOrderId: remote.razorpayOrderId,
          amountLocal: Number(local.amount),
          amountRazorpay: remote.amount,
          statusLocal: local.status,
          statusRazorpay: remote.status,
          mismatchType: 'amount',
          description: `Amount mismatch: local ₹${local.amount.toFixed(2)} vs Razorpay ${remote.currency} ${remote.amount.toFixed(2)}`,
          resolutionSuggested: 'Verify order total at checkout; check for discount/tax calculation discrepancies',
          createdAt: new Date(),
        })
      }

      // 6. Status reconciliation
      const statusMismatch = this.normalizeStatus(local.status) !== this.normalizeStatus(remote.status)
      if (statusMismatch) {
        mismatches.push({
          localPaymentId: local.id,
          razorpayOrderId: remote.razorpayOrderId,
          amountLocal: Number(local.amount),
          amountRazorpay: remote.amount,
          statusLocal: local.status,
          statusRazorpay: remote.status,
          mismatchType: 'status',
          description: `Status mismatch: local ${local.status} vs Razorpay ${remote.status}`,
          resolutionSuggested: 'Review webhook delivery logs; reprocess if needed',
          createdAt: new Date(),
        })
      }
    }

    // 7. Find local payments not found in remote (orphaned)
    //
    // PERFORMANCE: this used `remotePayments.some(...)` inside the loop, i.e.
    // O(N x M). Over a one-month window with thousands of payments that is tens
    // of millions of string comparisons on a single request. Build the id set
    // once: O(N + M).
    //
    // CORRECTNESS: `reconciled` was `localPayments.length - mismatches.length`,
    // but one payment can push TWO mismatch entries (an amount mismatch and a
    // status mismatch are recorded independently), so a payment with both
    // problems was subtracted twice and the reported reconciled count could go
    // negative. Count distinct payments that had no mismatch at all instead.
    const remoteIds = new Set(remotePayments.map((r) => r.razorpayOrderId).filter(Boolean))

    const paymentsWithMismatch = new Set<string>()
    for (const mismatch of mismatches) {
      paymentsWithMismatch.add(mismatch.localPaymentId)
    }

    if (remotePayments.length > 0) {
      for (const [, { payment: local }] of localIndex) {
        // `local.razorpayOrderId` is non-null by the query filter, but the Set
        // only holds defined ids, so compare against the narrowed value.
        const remoteId = local.razorpayOrderId
        if (remoteId && !remoteIds.has(remoteId)) {
          paymentsWithMismatch.add(local.id)
          // Local payment with no remote counterpart — likely webhook never arrived
          mismatches.push({
            localPaymentId: local.id,
            razorpayOrderId: local.razorpayOrderId ?? undefined,
            localPaymentIdRef: local.razorpayPaymentId ?? undefined,
            amountLocal: Number(local.amount),
            statusLocal: local.status,
            mismatchType: 'missing_remote',
            description: `Local payment ${local.id} (${local.status}) has no corresponding record in Razorpay`,
            resolutionSuggested: 'Verify webhook endpoint is public and reachable; check Razorpay webhook delivery logs',
            createdAt: new Date(),
          })
        }
      }
    }

    return {
      reconciled: Math.max(0, localPayments.length - paymentsWithMismatch.size),
      mismatches,
      missingInRazorpay: mismatches.filter((m) => m.mismatchType === 'missing_remote').length,
      missingInLocal: mismatches.filter((m) => m.mismatchType === 'missing_local').length,
      totalLocalPayments: localPayments.length,
      totalRazorpayPayments: remotePayments.length,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Reconciles payments specifically for a single Razorpay order.
   * Useful for manual review of a specific order.
   */
  public static async reconcileSingleOrder(razorpayOrderId: string): Promise<{
    reconciled: boolean
    mismatches: MismatchReport[]
  }> {
    const [payment] = await prisma.payment.findMany({
      where: { razorpayOrderId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            total: true,
            paymentStatus: true,
            status: true,
          },
        },
      },
    })

    if (!payment) {
      throw new AppError('Payment record not found', HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND)
    }

    const remotePayments = await this.fetchRemotePayments(
      payment.createdAt,
      new Date(payment.createdAt.getTime() + 86400000)
    )
    const remote = remotePayments.find((r) => r.razorpayOrderId === razorpayOrderId)

    if (!remote) {
      return {
        reconciled: false,
        mismatches: [
          {
            localPaymentId: payment.id,
            razorpayOrderId,
            amountLocal: Number(payment.amount),
            statusLocal: payment.status,
            mismatchType: 'missing_remote',
            description: `No record found in Razorpay for order ${payment.order?.orderNumber || 'unknown'}`,
            resolutionSuggested: 'Verify payment was actually initiated in Razorpay; check dashboard',
            createdAt: new Date(),
          },
        ],
      }
    }

    const mismatches: MismatchReport[] = []

    if (this.roundAmount(Number(payment.amount)) !== this.roundAmount(remote.amount)) {
      mismatches.push({
        localPaymentId: payment.id,
        amountLocal: Number(payment.amount),
        amountRazorpay: remote.amount,
        statusLocal: payment.status,
        statusRazorpay: remote.status,
        mismatchType: 'amount',
        description: `Amount mismatch: local ₹${payment.amount.toFixed(2)} vs Razorpay ${remote.currency} ${remote.amount.toFixed(2)}`,
        resolutionSuggested: 'Verify order total at checkout',
        createdAt: new Date(),
      })
    }

    if (this.normalizeStatus(payment.status) !== this.normalizeStatus(remote.status)) {
      mismatches.push({
        localPaymentId: payment.id,
        amountLocal: Number(payment.amount),
        amountRazorpay: remote.amount,
        statusLocal: payment.status,
        statusRazorpay: remote.status,
        mismatchType: 'status',
        description: `Status mismatch: local ${payment.status} vs Razorpay ${remote.status}`,
        resolutionSuggested: 'Review webhook logs and reprocess if needed',
        createdAt: new Date(),
      })
    }

    return {
      reconciled: mismatches.length === 0,
      mismatches,
    }
  }

  /**
   * Reconciles invoices with payments and orders.
   * Ensures every paid order has an invoice, every invoice has a payment, etc.
   */
  public static async reconcileInvoices(params: ReconciliationParams): Promise<{
    invoices: Array<{
      invoiceNumber: string
      orderNumber: string
      orderStatus: string
      paymentStatus: PaymentStatus
      invoiceStatus: InvoiceStatus
      mismatches: string[]
    }>
    summary: {
      totalInvoices: number
      orphaned: number
      unpaidWithInvoice: number
      paidWithoutInvoice: number
    }
  }> {
    const { from, to } = params

    const invoices = await prisma.invoice.findMany({
      where: {
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            total: true,
            payment: {
              select: {
                id: true,
                razorpayOrderId: true,
                razorpayPaymentId: true,
                status: true,
                amount: true,
                verifiedAt: true,
              },
            },
          },
        },
      },
    })

    const result: Array<{
      invoiceNumber: string
      orderNumber: string
      orderStatus: string
      paymentStatus: PaymentStatus
      invoiceStatus: InvoiceStatus
      mismatches: string[]
    }> = []

    let unpaidWithInvoice = 0
    let paidWithoutInvoice = 0

    // Cross-check every paid order has an invoice.
    //
    // PERFORMANCE: this previously had NO date filter at all, so it read every
    // paid order in the table's history regardless of the requested window —
    // unbounded, and inconsistent with the `invoices` query above it which is
    // windowed. Scoped to the same range and capped.
    const paidOrders = await prisma.order.findMany({
      where: {
        paymentStatus: PaymentStatus.PAID,
        createdAt: { gte: from, lte: to },
      },
      take: RECONCILIATION_MAX_ROWS,
      select: {
        id: true,
        orderNumber: true,
      },
    })

    const paidOrderIds = new Set(paidOrders.map((o) => o.id))
    const invoiceOrderIds = new Set(invoices.map((i) => i.orderId))

    paidWithoutInvoice = paidOrders.filter((o) => !invoiceOrderIds.has(o.id)).length

    for (const invoice of invoices) {
      const mismatches: string[] = []

      const order = invoice.order

      // 1. Payment exists and is verified
      if (!order.payment || !order.payment.razorpayPaymentId) {
        mismatches.push('No verified Razorpay payment found')
      } else if (order.payment.status === PaymentRecordStatus.FAILED) {
        mismatches.push('Payment record is marked FAILED')
      }

      // 2. Invoice status matches payment status
      const expectedStatus =
        order.paymentStatus === PaymentStatus.PAID ? InvoiceStatus.PAID : InvoiceStatus.ISSUED
      if (invoice.status !== expectedStatus) {
        mismatches.push(
          `Invoice status '${invoice.status}' does not match payment status '${order.paymentStatus}'`
        )
      }

      // 3. Invoice totals match order totals
      const tolerance = 0.01
      const totalMatch =
        Math.abs(Number(invoice.total) - Number(order.total)) < tolerance

      if (!totalMatch) {
        mismatches.push(
          `Invoice total ₹${invoice.total} differs from order total ₹${order.total}`
        )
      }

      // 4. Invoice amount matches payment amount
      if (order.payment && order.payment.razorpayPaymentId) {
        const amountMatch = Math.abs(Number(invoice.total) - Number(order.payment.amount)) < tolerance
        if (!amountMatch) {
          mismatches.push(
            `Invoice total ₹${invoice.total} differs from payment amount ₹${order.payment.amount}`
          )
        }
      }

      result.push({
        invoiceNumber: invoice.invoiceNumber,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        invoiceStatus: invoice.status,
        mismatches,
      })
    }

    // Check for orphaned invoices (order deleted or payment removed)
    const orphaned = invoices.filter(
      (i) =>
        !paidOrderIds.has(i.orderId) &&
        (!i.order.payment || !i.order.payment.razorpayPaymentId)
    ).length

    // Check paid orders without invoices
    paidWithoutInvoice = paidOrders.filter((o) => !invoiceOrderIds.has(o.id)).length

    // Invoices issued against orders that have NOT been marked paid — the
    // inventory of invoices whose `paymentStatus` is still pending/failed.
    // Previously this field was assigned `paidWithoutInvoice`, duplicating the
    // "paid orders with no invoice" count and leaving the real unpaid-invoices
    // figure permanently at zero.
    unpaidWithInvoice = invoices.filter((i) => i.order.paymentStatus !== PaymentStatus.PAID).length

    return {
      invoices: result,
      summary: {
        totalInvoices: invoices.length,
        orphaned,
        unpaidWithInvoice,
        paidWithoutInvoice,
      },
    }
  }

  /**
   * Fetches remote payments from Razorpay for a date range
   * (`GET /v1/payments`, paged at 100 per request).
   *
   * Amounts are converted from paise to rupees, because `Payment.amount` is
   * stored in rupees and every comparison in this service is done in rupees.
   *
   * This deliberately does NOT fall back to an empty list on failure. An empty
   * remote set makes every local payment look like a missed webhook, so the
   * report would be 100% false positives while looking authoritative. Failing
   * the request is the honest answer.
   */
  private static async fetchRemotePayments(from: Date, to: Date): Promise<RemotePaymentRecord[]> {
    const deadline = Date.now() + REMOTE_FETCH_BUDGET_MS
    const fromUnix = Math.floor(from.getTime() / 1000)
    const toUnix = Math.ceil(to.getTime() / 1000)
    const payments: RemotePaymentRecord[] = []
    let withoutOrderId = 0

    try {
      for (let skip = 0; ; skip += RAZORPAY_PAGE_SIZE) {
        if (payments.length >= RECONCILIATION_MAX_ROWS) {
          throw new AppError(
            `This window holds more than ${RECONCILIATION_MAX_ROWS} gateway payments. Narrow the date range so the report is not truncated.`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.BAD_REQUEST,
          )
        }

        const page = await this.withTimeout(
          razorpayClient.payments.all({
            from: fromUnix,
            to: toUnix,
            count: RAZORPAY_PAGE_SIZE,
            skip,
          }),
          Math.max(1, deadline - Date.now()),
        )

        const items = page.items ?? []
        for (const item of items) {
          // Payments taken outside an order (direct payment links) carry no
          // order id and cannot be joined to a local row. Counted rather than
          // silently dropped, so the report's totals still add up.
          if (!item.order_id) {
            withoutOrderId += 1
            continue
          }
          payments.push({
            razorpayOrderId: item.order_id,
            paymentId: item.id,
            amount: Number(item.amount) / 100,
            currency: item.currency,
            status: item.status,
          })
        }

        if (items.length < RAZORPAY_PAGE_SIZE) break
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      logger.error(
        { from, to, error: error instanceof Error ? error.message : error },
        'Reconciliation: could not fetch payments from Razorpay',
      )
      throw new AppError(
        'Payment records could not be fetched from Razorpay. The report was not generated, rather than reporting every local payment as missing.',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PAYMENT_ERROR,
      )
    }

    if (withoutOrderId > 0) {
      logger.warn(
        { withoutOrderId },
        'Reconciliation: skipped gateway payments that carry no order id',
      )
    }

    return payments
  }

  /**
   * Rejects once `ms` elapses so a stalled dependency cannot hang the request.
   * The losing branch of `Promise.race` still has handlers attached, so a late
   * rejection cannot become an unhandled rejection.
   */
  private static async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Razorpay payments request timed out')), ms)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * Normalizes payment status strings for comparison.
   */
  private static normalizeStatus(status: any): string {
    if (typeof status === 'string') {
      const value = status.toLowerCase()
      // Razorpay calls a payment that exists but has not yet been authorized
      // `created`; the same in-flight state is `PENDING` locally. Comparing the
      // raw strings would flag every in-flight payment as a status mismatch.
      return value === 'created' ? 'pending' : value
    }
    if (status && typeof status === 'object') {
      if (status.name) return status.name.toLowerCase()
      return 'unknown'
    }
    return 'unknown'
  }

  /**
   * Rounds amounts for currency comparison (INR has no fractional units in paise).
   */
  private static roundAmount(amount: number): number {
    return Math.round(amount * 100)
  }
}