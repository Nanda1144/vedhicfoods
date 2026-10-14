import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { EmailService } from './email.service'
import { NotificationCenterService } from './notification-center.service'
import { NotificationType } from '@prisma/client'
import type { TemplateVariables } from '../templates/email-templates'

type OrderWithItems = {
  id: string
  orderNumber: string
  userId: string
  customerName: string
  customerEmail: string
  phone?: string | null
  subtotal: unknown
  discount: unknown
  shipping: unknown
  tax: unknown
  total: unknown
  paymentMethod: string
  paymentStatus: string
  status: string
  createdAt: Date
  trackingNumber?: string | null
  courier?: string | null
  shippingAddressSnapshot?: unknown
  items: Array<{
    name: string
    quantity: number
    price?: unknown
    unitPrice?: unknown
    subtotal?: unknown
    total?: unknown
  }>
}

function num(value: unknown): number {
  return Number(value ?? 0)
}

function buildOrderVars(order: OrderWithItems): TemplateVariables {
  const snapshot = (order.shippingAddressSnapshot ?? null) as Record<string, any> | null

  return {
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderDate: order.createdAt.toISOString(),
    subtotal: num(order.subtotal),
    discount: num(order.discount),
    shipping: num(order.shipping),
    tax: num(order.tax),
    totalAmount: num(order.total),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    trackingNumber: order.trackingNumber ?? undefined,
    carrier: order.courier ?? undefined,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: num(item.unitPrice ?? item.price),
      total: item.subtotal !== undefined ? num(item.subtotal) : num(item.total),
    })),
    shippingAddress: snapshot
      ? {
          fullName: snapshot.fullName ?? order.customerName,
          line1: snapshot.line1 ?? snapshot.addressLine1 ?? '',
          line2: snapshot.line2 ?? snapshot.addressLine2 ?? undefined,
          city: snapshot.city ?? '',
          state: snapshot.state ?? '',
          pincode: snapshot.pincode ?? snapshot.postalCode ?? '',
          country: snapshot.country ?? 'India',
        }
      : undefined,
  }
}

/**
 * Builds customer/admin notification emails from an order.
 *
 * Centralised so every lifecycle hook (payment capture, delivery transition,
 * cancellation, refund) renders the same order summary and each send is
 * wrapped in the same non-fatal guard: a mail failure must never roll back the
 * payment, delivery or inventory state transition that triggered it.
 */
export class OrderEmailService {
  private static async load(orderId: string): Promise<OrderWithItems | null> {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    }) as Promise<OrderWithItems | null>
  }

  private static async safely(label: string, orderId: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (error: any) {
      logger.error({ error: error?.message, orderId, hook: label }, 'Order email dispatch failed (non-fatal)')
    }
  }

  /**
   * Mirror an order lifecycle event into the customer's in-app inbox using the
   * same dedupe key as the parallel email, so a replayed payment webhook can
   * never duplicate either channel. Non-fatal by design: an inbox write failing
   * must not roll back the order state transition it accompanies.
   */
  private static async inbox(
    params: {
      order: OrderWithItems
      eventKey: string
      type: NotificationType
      title: string
      message: string
      metadata?: Record<string, unknown>
    }
  ): Promise<void> {
    if (!params.order.userId) return
    await NotificationCenterService.emit({
      userId: params.order.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      eventKey: params.eventKey,
      metadata: {
        ...(params.metadata ?? {}),
        orderId: params.order.id,
        orderNumber: params.order.orderNumber,
      },
    })
  }

  /** Customer payment-confirmation, fired once per captured payment. */
  public static async paymentConfirmed(orderId: string, dedupeKey?: string): Promise<void> {
    await OrderEmailService.safely('payment_confirmed', orderId, async () => {
      const order = await OrderEmailService.load(orderId)
      if (!order) return
      const key = dedupeKey ?? `payment_confirmed:${orderId}`
      await EmailService.sendPaymentConfirmation(buildOrderVars(order), key)
      await OrderEmailService.inbox({
        order,
        eventKey: key,
        type: NotificationType.PAYMENT_UPDATE,
        title: 'Payment confirmed',
        message: `Your payment for order ${order.orderNumber} was confirmed successfully.`,
      })
    })
  }

  /** Customer payment-failure notice. */
  public static async paymentFailed(orderId: string, reason?: string, dedupeKey?: string): Promise<void> {
    await OrderEmailService.safely('payment_failed', orderId, async () => {
      const order = await OrderEmailService.load(orderId)
      if (!order) return
      const key = dedupeKey ?? `payment_failed:${orderId}`
      await EmailService.sendPaymentFailure({ ...buildOrderVars(order), failureReason: reason }, key)
      await OrderEmailService.inbox({
        order,
        eventKey: key,
        type: NotificationType.PAYMENT_UPDATE,
        title: 'Payment failed',
        message: `We could not process payment for order ${order.orderNumber}. Please try again or contact support.`,
      })
    })
  }

  /** Customer cancellation notice. */
  public static async orderCancelled(orderId: string, reason?: string, dedupeKey?: string): Promise<void> {
    await OrderEmailService.safely('order_cancelled', orderId, async () => {
      const order = await OrderEmailService.load(orderId)
      if (!order) return
      const key = dedupeKey ?? `order_cancelled:${orderId}`
      await EmailService.sendOrderCancelled({ ...buildOrderVars(order), cancellationReason: reason }, key)
      await OrderEmailService.inbox({
        order,
        eventKey: key,
        type: NotificationType.ORDER_UPDATE,
        title: 'Order cancelled',
        message: `Order ${order.orderNumber} was cancelled.`,
        metadata: reason ? { cancellationReason: reason } : undefined,
      })
    })
  }

  /** Customer refund notice. */
  public static async refundProcessed(
    orderId: string,
    refund: { refundId?: string; amount?: number; status?: string },
    dedupeKey?: string
  ): Promise<void> {
    await OrderEmailService.safely('refund', orderId, async () => {
      const order = await OrderEmailService.load(orderId)
      if (!order) return
      const key = dedupeKey ?? `refund:${orderId}:${refund.refundId ?? 'na'}`
      await EmailService.sendRefund(
        {
          ...buildOrderVars(order),
          refundId: refund.refundId,
          refundAmount: refund.amount,
          refundStatus: refund.status ?? 'initiated',
        },
        key
      )
      await OrderEmailService.inbox({
        order,
        eventKey: key,
        type: NotificationType.PAYMENT_UPDATE,
        title: 'Refund processed',
        message: `A refund of Rs.${num(refund.amount ?? 0).toFixed(2)} for order ${order.orderNumber} ${refund.status === 'successful' ? 'has been processed' : 'is being processed'}.`,
        metadata: { refundId: refund.refundId },
      })
    })
  }

  /** Delivery lifecycle update (shipped / out for delivery / delivered). */
  public static async deliveryUpdate(
    orderId: string,
    phase: 'shipped' | 'out_for_delivery' | 'delivered',
    dedupeKey?: string
  ): Promise<void> {
    await OrderEmailService.safely(`delivery_${phase}`, orderId, async () => {
      const order = await OrderEmailService.load(orderId)
      if (!order) return
      const vars = buildOrderVars(order)
      const key = dedupeKey ?? `delivery_${phase}:${orderId}`

      if (phase === 'shipped') await EmailService.sendShipment(vars, key)
      else if (phase === 'out_for_delivery') await EmailService.sendOutForDelivery(vars, key)
      else await EmailService.sendDelivery({ ...vars, deliveryDate: new Date().toISOString() }, key)

      const inboxType =
        phase === 'shipped' ? NotificationType.ORDER_UPDATE : NotificationType.DELIVERY_UPDATE
      const inboxTitle =
        phase === 'shipped'
          ? 'Order shipped'
          : phase === 'out_for_delivery'
            ? 'Out for delivery'
            : 'Order delivered'
      const inboxMessage =
        phase === 'shipped'
          ? `Order ${order.orderNumber} has been shipped.`
          : phase === 'out_for_delivery'
            ? `Order ${order.orderNumber} is out for delivery today.`
            : `Order ${order.orderNumber} was delivered. Enjoy!`

      await OrderEmailService.inbox({
        order,
        eventKey: key,
        type: inboxType,
        title: inboxTitle,
        message: inboxMessage,
      })
    })
  }

  /** Operations-inbox alert that a paid order needs fulfilment. */
  public static async notifyAdminPaidOrder(orderId: string, dedupeKey?: string): Promise<void> {
    await OrderEmailService.safely('admin_paid_order', orderId, async () => {
      const order = await OrderEmailService.load(orderId)
      if (!order) return
      const key = dedupeKey ?? `admin_paid_order:${orderId}`
      await EmailService.sendAdminNotification(
        {
          ...buildOrderVars(order),
          adminMessage: `Paid order ${order.orderNumber} from ${order.customerName} (${order.customerEmail}) is ready for fulfilment. Total: Rs.${num(order.total).toFixed(2)}.`,
        },
        key
      )
      await NotificationCenterService.broadcastToRoleActors({
        roles: ['ADMIN', 'OWNER'],
        type: NotificationType.SYSTEM_ALERT,
        title: 'Paid order awaiting fulfilment',
        message: `Order ${order.orderNumber} from ${order.customerName} (${order.customerEmail}) is paid and ready for fulfilment.`,
        eventKey: key,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      })
    })
  }
}
