import { OrderStatus } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { env } from '../config/env'
import { InventoryService } from './inventory.service'
import { AuditService } from './audit.service'

export interface ReservationSweepResult {
  scanned: number
  reaped: number
}

/**
 * Arbitrary but stable 64-bit key for the sweep's advisory lock. Chosen once
 * and never changed; a different key in another process would not exclude this
 * one.
 */
const SWEEP_ADVISORY_LOCK_KEY = 768_531_902_144n

const SWEEP_NOTE = 'Auto-cancelled: payment reservation expired'

/**
 * Releases stock held by checkouts that were started but never paid for.
 *
 * WHY THIS EXISTS: `reserveStock` moves quantity from `availableQuantity` to
 * `reservedQuantity` when a Razorpay order is created, and the payment
 * webhook/callback releases it only when payment actually *fails*. A customer
 * who simply closes the tab leaves the order in `PENDING_PAYMENT` forever, so
 * the reserved units are never returned and the storefront slowly sells out of
 * stock it still has. Nothing else in the codebase reclaims them.
 *
 * SAFETY: the whole pass runs in a single transaction guarded by
 * `pg_try_advisory_xact_lock`, so with several instances only one sweeps at a
 * time, and the lock is released automatically when the transaction ends (a
 * session-level lock would leak across the connection pool). Each order is
 * claimed with a conditional `UPDATE ... WHERE status = 'PENDING_PAYMENT'`, so a
 * concurrent payment that confirms the order wins the race and the order is
 * left untouched.
 */
export class ReservationSweepService {
  private static timer?: NodeJS.Timeout

  static start(intervalMs: number): void {
    if (ReservationSweepService.timer) return
    ReservationSweepService.timer = setInterval(() => {
      void ReservationSweepService.runOnce().catch((error: any) =>
        logger.error({ error: error?.message }, 'Reservation sweep failed')
      )
    }, intervalMs)
    ReservationSweepService.timer.unref()
    logger.info(
      { intervalMs, ttlMs: env.RESERVATION_TTL_MS },
      'Reservation sweep started'
    )
  }

  static stop(): void {
    if (!ReservationSweepService.timer) return
    clearInterval(ReservationSweepService.timer)
    ReservationSweepService.timer = undefined
  }

  static async runOnce(): Promise<ReservationSweepResult> {
    const cutoff = new Date(Date.now() - env.RESERVATION_TTL_MS)

    return prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SWEEP_ADVISORY_LOCK_KEY}::bigint) AS locked
        `
        if (!lockRows[0]?.locked) {
          return { scanned: 0, reaped: 0 }
        }

        const stale = await tx.order.findMany({
          where: { status: OrderStatus.PENDING_PAYMENT, createdAt: { lt: cutoff } },
          select: {
            id: true,
            orderNumber: true,
            userId: true,
            items: { select: { productId: true, quantity: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: env.RESERVATION_SWEEP_BATCH,
        })

        let reaped = 0
        for (const order of stale) {
          // Conditional claim: if the payment landed while we were scanning,
          // `status` is no longer PENDING_PAYMENT and this affects 0 rows, so we
          // must not touch its reservation.
          const affected = await tx.$executeRaw`
            UPDATE orders
            SET status = 'CANCELLED'::"OrderStatus",
                notes = LEFT(CONCAT_WS(E'\n', notes, ${SWEEP_NOTE}), 2000),
                "updatedAt" = now()
            WHERE id = ${order.id}
              AND status = 'PENDING_PAYMENT'::"OrderStatus"
              AND "createdAt" < ${cutoff}
          `
          if (affected === 0) continue

          const items = order.items
            .filter((item) => Boolean(item.productId))
            .map((item) => ({ productId: item.productId as string, quantity: item.quantity }))

          if (items.length > 0) {
            await InventoryService.releaseReservation(
              items,
              {
                orderId: order.id,
                orderNumber: order.orderNumber,
                reason: SWEEP_NOTE,
              },
              tx
            )
          }

          await AuditService.record({
            action: 'ORDER_STATUS_UPDATED',
            entity: 'Order',
            entityId: order.id,
            metadata: {
              orderNumber: order.orderNumber,
              previousStatus: OrderStatus.PENDING_PAYMENT,
              newStatus: OrderStatus.CANCELLED,
              reason: SWEEP_NOTE,
              source: 'reservation_sweep',
            },
            tx,
          })

          reaped++
        }

        if (reaped > 0) {
          logger.warn({ scanned: stale.length, reaped }, 'Reaped expired stock reservations')
        }

        return { scanned: stale.length, reaped }
      },
      { timeout: 60000, maxWait: 15000 }
    )
  }
}
