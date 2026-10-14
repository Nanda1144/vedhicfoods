import { NotificationType, Prisma, RoleName } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { publish } from '../events/realtime'

export interface EmitNotificationParams {
  userId: string
  type: NotificationType
  title: string
  message: string
  /**
   * Per-user idempotency key for a single logical business event.
   * Enforced by the partial unique index on (userId, eventKey): a webhook
   * replay or concurrent retry can never insert a second row, so callers can
   * safely re-fire an event handler as many times as provider delivery
   * semantics demand without orphaning duplicates.
   */
  eventKey?: string
  metadata?: Record<string, unknown>
}

export interface EmitResult {
  /** The notification row (existing one when the event was a duplicate). */
  notification: { id: string } | null
  /** True only when this call inserted a new row. */
  created: boolean
}

/**
 * In-app notification centre.
 *
 * `notifications` is the platform's persisted, per-user inbox. Business
 * subsystems (orders, payments, deliveries, promotions, support) emit a
 * notification here for every customer-facing event at the exact points where
 * they already fire transactional email, using the *same* dedupe key so the
 * in-app record count always mirrors the underlying business event.
 *
 * All emission is best-effort and non-fatal by contract: a notification write
 * failure must never roll back or block the state transition that produced the
 * event, so `emit` swallows and logs errors instead of throwing.
 */
export class NotificationCenterService {
  /**
   * Insert one notification for a single recipient, or no-op on a duplicate of
   * the same logical event. Race-safe: concurrent calls with the same eventKey
   * resolve to exactly one row.
   */
  public static async emit(params: EmitNotificationParams): Promise<EmitResult> {
    try {
      if (params.eventKey) {
        // Fast path for the overwhelmingly common repeat case (a webhook is
        // replayed, an admin retries a publish): check before insert so the
        // unique-key violation is not exercised on every duplicate. The P2002
        // fallback below stays as the race-safe backstop.
        const existing = await prisma.notification.findFirst({
          where: { userId: params.userId, eventKey: params.eventKey },
          select: { id: true },
        })
        if (existing) return { notification: existing, created: false }
      }

      const notification = await prisma.notification.create({
        data: {
          userId: params.userId,
          type: params.type,
          title: params.title,
          message: params.message,
          eventKey: params.eventKey ?? null,
          metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
        },
      })
      // Real-time push: a staff console with an open `/events` stream sees the
      // inbox counter move the moment a ticket/order event lands.
      try {
        publish('notification.created', {
          id: notification.id,
          userId: params.userId,
          type: params.type,
          title: params.title,
        })
      } catch {
        // never take the notification path down with the fan-out
      }
      return { notification, created: true }
    } catch (error) {
      if (
        params.eventKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Duplicate dispatch: the row for this (userId, eventKey) already exists
        // after another concurrent writer won the insert.
        const existing = await prisma.notification.findFirst({
          where: { userId: params.userId, eventKey: params.eventKey },
          select: { id: true },
        })
        if (existing) return { notification: existing, created: false }
      }
      logger.error(
        { err: (error as Error)?.message, userId: params.userId, eventKey: params.eventKey },
        'In-app notification emit failed (non-fatal)'
      )
    }
    return { notification: null, created: false }
  }

  /**
   * Emit the same notification to every active holder of the given roles
   * (used for staff/admin alerts and promotion broadcasts). Each recipient is
   * deduplicated independently by its own (userId, eventKey) row.
   *
   * Returns the number of recipients the notification was attempted for.
   */
  public static async broadcastToRoleActors(params: {
    roles: RoleName[]
    type: NotificationType
    title: string
    message: string
    eventKey: string
    metadata?: Record<string, unknown>
  }): Promise<number> {
    const roleRows = await prisma.userRole.findMany({
      where: { role: { name: { in: params.roles } } },
      select: { userId: true },
      distinct: ['userId'],
    })
    if (roleRows.length === 0) return 0
    const roleUserIds = roleRows.map((row) => row.userId)

    // The site's own address typo-proofing: owners/admins/staff listed as role
    // holders are only notified when their account is alive and not deleted.
    const users = await prisma.user.findMany({
      where: {
        id: { in: roleUserIds },
        isActive: true,
        isDeleted: false,
      },
      select: { id: true },
    })

    await Promise.all(
      users.map((user) =>
        NotificationCenterService.emit({
          userId: user.id,
          type: params.type,
          title: params.title,
          message: params.message,
          eventKey: params.eventKey,
          metadata: params.metadata,
        })
      )
    )
    return users.length
  }

  /**
   * Emit a notification to the owner of an order. The order's `userId` is
   * resolved once here so callers only need an order id.
   */
  public static async emitToOrderCustomer(params: {
    orderId: string
    orderNumber: string
    type: NotificationType
    title: string
    message: string
    eventKey: string
    metadata?: Record<string, unknown>
  }): Promise<EmitResult> {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      select: { userId: true },
    })
    if (!order?.userId) return { notification: null, created: false }
    return NotificationCenterService.emit({
      userId: order.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      eventKey: params.eventKey,
      metadata: { ...(params.metadata ?? {}), orderId: params.orderId, orderNumber: params.orderNumber },
    })
  }
}