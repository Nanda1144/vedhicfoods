import { Prisma, DeliveryStatus, OrderStatus, PaymentStatus, PaymentRecordStatus } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { InventoryService } from './inventory.service'
import { OrderEmailService } from './order-email.service'
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors'
import {
  ListDeliveriesQuery,
  UpdateDeliveryInput,
  AssignDeliveryInput,
  UpdateDeliveryStatusInput,
  PaginatedDeliveriesResponse,
  DeliveryDetailResponse,
  CustomerDeliveryResponse,
  VALID_DELIVERY_TRANSITIONS,
  DELIVERY_TO_ORDER_STATUS_MAP,
} from '../types/delivery.types'

export class DeliveryService {
  /**
   * Resolves or provisions a Delivery record given a delivery ID, order ID, or orderNumber.
   * Auto-provisions a PENDING delivery record if the order exists without one.
   */
  public static async resolveDelivery(
    identifier: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || prisma
    const trimmedId = identifier.trim()

    // 1. Direct Delivery lookup by primary key
    let delivery = await client.delivery.findUnique({
      where: { id: trimmedId },
      include: {
        order: {
          include: {
            items: true,
            payment: true,
          },
        },
        assignedStaff: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    })

    if (delivery) {
      return delivery
    }

    // 2. Lookup associated Order by order ID or human-readable orderNumber
    const order = await client.order.findFirst({
      where: {
        OR: [
          { id: trimmedId },
          { orderNumber: trimmedId },
        ],
      },
      include: {
        items: true,
        payment: true,
      },
    })

    if (!order) {
      throw new NotFoundError(`Delivery or Order '${trimmedId}' not found`)
    }

    // 3. Find or auto-provision Delivery record for this order
    delivery = await client.delivery.findUnique({
      where: { orderId: order.id },
      include: {
        order: {
          include: {
            items: true,
            payment: true,
          },
        },
        assignedStaff: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    })

    if (!delivery) {
      const initialStatus = order.status === OrderStatus.CANCELLED
        ? DeliveryStatus.CANCELLED
        : DeliveryStatus.PENDING

      delivery = await client.delivery.create({
        data: {
          orderId: order.id,
          status: initialStatus,
          courierPartner: order.courier || 'Delhivery Express',
          trackingNumber: order.trackingNumber || null,
          recipientName: order.customerName,
          recipientPhone: order.phone,
          history: {
            create: {
              status: initialStatus,
              notes: `Delivery record provisioned for order ${order.orderNumber}`,
            },
          },
        },
        include: {
          order: {
            include: {
              items: true,
              payment: true,
            },
          },
          assignedStaff: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
            },
          },
        },
      })
    }

    return delivery
  }

  /**
   * GET /api/v1/admin/delivery
   * Paginated listing of all delivery records with filtering, searching, and sorting.
   */
  public static async listDeliveries(query: ListDeliveriesQuery): Promise<PaginatedDeliveriesResponse> {
    const { page, limit, status, assignedStaffId, search, sortBy, sortOrder } = query
    const skip = (page - 1) * limit

    const where: Prisma.DeliveryWhereInput = {}

    if (status) {
      where.status = status
    }

    if (assignedStaffId) {
      where.assignedStaffId = assignedStaffId
    }

    if (search) {
      where.OR = [
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { courierPartner: { contains: search, mode: 'insensitive' } },
        { recipientName: { contains: search, mode: 'insensitive' } },
        { recipientPhone: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
        { order: { customerName: { contains: search, mode: 'insensitive' } } },
        { order: { customerEmail: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [total, deliveries] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              customerName: true,
              phone: true,
              status: true,
            },
          },
          assignedStaff: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
    ])

    return {
      deliveries: deliveries.map((d) => ({
        id: d.id,
        orderId: d.orderId,
        orderNumber: d.order.orderNumber,
        customerName: d.recipientName || d.order.customerName,
        phone: d.recipientPhone || d.order.phone,
        status: d.status,
        orderStatus: d.order.status,
        courierPartner: d.courierPartner,
        trackingNumber: d.trackingNumber,
        estimatedDelivery: d.estimatedDelivery,
        deliveredAt: d.deliveredAt,
        assignedStaff: d.assignedStaff,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    }
  }

  /**
   * GET /api/v1/admin/delivery/:id
   * Detailed delivery view with complete order snapshot, items, staff details, and audit history.
   */
  public static async getDeliveryById(idOrOrderNumber: string): Promise<DeliveryDetailResponse> {
    const delivery = await this.resolveDelivery(idOrOrderNumber)

    // PERFORMANCE: the status history was unbounded. A long-running delivery can
    // accumulate an arbitrary number of transitions, and every one of them was
    // returned to the caller. Bounded to the most recent entries, which is what
    // any consumer actually renders.
    const history = await prisma.deliveryHistory.findMany({
      where: { deliveryId: delivery.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        actorId: true,
        actorEmail: true,
        notes: true,
        assignedToId: true,
        metadata: true,
        createdAt: true,
      },
    })

    return {
      id: delivery.id,
      orderId: delivery.orderId,
      orderNumber: delivery.order.orderNumber,
      status: delivery.status,
      courierPartner: delivery.courierPartner,
      trackingNumber: delivery.trackingNumber,
      trackingUrl: delivery.trackingUrl,
      estimatedDelivery: delivery.estimatedDelivery,
      deliveredAt: delivery.deliveredAt,
      deliveryNotes: delivery.deliveryNotes,
      recipientName: delivery.recipientName,
      recipientPhone: delivery.recipientPhone,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      assignedStaff: delivery.assignedStaff,
      order: {
        id: delivery.order.id,
        orderNumber: delivery.order.orderNumber,
        customerName: delivery.order.customerName,
        customerEmail: delivery.order.customerEmail,
        phone: delivery.order.phone,
        status: delivery.order.status,
        paymentStatus: delivery.order.paymentStatus,
        total: Number(delivery.order.total),
        shippingAddressSnapshot: delivery.order.shippingAddressSnapshot,
        itemsCount: delivery.order.items.length,
      },
      history,
    }
  }

  /**
   * PATCH /api/v1/admin/delivery/:id
   * Updates delivery metadata (courier, tracking, recipient, estimated delivery, notes).
   */
  public static async updateDelivery(
    idOrOrderNumber: string,
    input: UpdateDeliveryInput,
    actor: { id: string; email: string }
  ): Promise<DeliveryDetailResponse> {
    const existing = await this.resolveDelivery(idOrOrderNumber)

    if (existing.status === DeliveryStatus.CANCELLED) {
      throw new BadRequestError('Cannot update delivery metadata for a cancelled order/delivery')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updateData: Prisma.DeliveryUpdateInput = {}

      if (input.courierPartner !== undefined) updateData.courierPartner = input.courierPartner
      if (input.trackingNumber !== undefined) updateData.trackingNumber = input.trackingNumber
      if (input.trackingUrl !== undefined) updateData.trackingUrl = input.trackingUrl
      if (input.estimatedDelivery !== undefined) updateData.estimatedDelivery = input.estimatedDelivery
      if (input.recipientName !== undefined) updateData.recipientName = input.recipientName
      if (input.recipientPhone !== undefined) updateData.recipientPhone = input.recipientPhone
      if (input.deliveryNotes !== undefined) {
        updateData.deliveryNotes = input.deliveryNotes
      }

      const deliveryRecord = await tx.delivery.update({
        where: { id: existing.id },
        data: updateData,
      })

      // Synchronize tracking and courier to the order table as well
      if (input.trackingNumber || input.courierPartner) {
        await tx.order.update({
          where: { id: existing.orderId },
          data: {
            ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
            ...(input.courierPartner ? { courier: input.courierPartner } : {}),
          },
        })
      }

      return deliveryRecord
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'DELIVERY_METADATA_UPDATED',
      entity: 'Delivery',
      entityId: updated.id,
      metadata: { input, orderNumber: existing.order.orderNumber },
    })

    return this.getDeliveryById(updated.id)
  }

  /**
   * POST /api/v1/admin/delivery/:id/assign
   * Assigns or reassigns delivery staff.
   * If status is PENDING, transitions to ASSIGNED.
   * Records assignment history and system audit log.
   */
  public static async assignStaff(
    idOrOrderNumber: string,
    input: AssignDeliveryInput,
    actor: { id: string; email: string }
  ): Promise<DeliveryDetailResponse> {
    const delivery = await this.resolveDelivery(idOrOrderNumber)

    if (delivery.status === DeliveryStatus.CANCELLED) {
      throw new BadRequestError('Cannot assign delivery staff to a cancelled order')
    }

    if (delivery.status === DeliveryStatus.DELIVERED) {
      throw new BadRequestError('Cannot reassign delivery staff for an already delivered order')
    }

    // Verify assigned staff member exists
    const staffMember = await prisma.user.findUnique({
      where: { id: input.assignedStaffId },
    })

    if (!staffMember || !staffMember.isActive) {
      throw new BadRequestError('Specified staff user does not exist or is inactive')
    }

    const previousStaffId = delivery.assignedStaffId
    const newStatus = delivery.status === DeliveryStatus.PENDING
      ? DeliveryStatus.ASSIGNED
      : delivery.status

    await prisma.$transaction(async (tx) => {
      // 1. Update delivery record
      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          assignedStaffId: input.assignedStaffId,
          status: newStatus,
          deliveryNotes: input.notes
            ? (delivery.deliveryNotes ? `${delivery.deliveryNotes}\n${input.notes}` : input.notes)
            : delivery.deliveryNotes,
        },
      })

      // 2. If transitioning from PENDING to ASSIGNED, advance CONFIRMED order to PROCESSING
      if (delivery.status === DeliveryStatus.PENDING && delivery.order.status === OrderStatus.CONFIRMED) {
        await tx.order.update({
          where: { id: delivery.orderId },
          data: { status: OrderStatus.PROCESSING },
        })
      }

      // 3. Log history entry
      await tx.deliveryHistory.create({
        data: {
          deliveryId: delivery.id,
          status: newStatus,
          actorId: actor.id,
          actorEmail: actor.email,
          assignedToId: input.assignedStaffId,
          notes: input.notes || `Assigned to delivery staff member ${staffMember.fullName}`,
          metadata: {
            previousStaffId,
            newStaffId: input.assignedStaffId,
            staffName: staffMember.fullName,
          },
        },
      })
    })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'DELIVERY_STAFF_ASSIGNED',
      entity: 'Delivery',
      entityId: delivery.id,
      metadata: {
        previousStaffId,
        newStaffId: input.assignedStaffId,
        staffName: staffMember.fullName,
        notes: input.notes,
        orderNumber: delivery.order.orderNumber,
      },
    })

    logger.info(
      { deliveryId: delivery.id, staffId: input.assignedStaffId, orderNumber: delivery.order.orderNumber },
      'Delivery successfully assigned to staff member'
    )

    return this.getDeliveryById(delivery.id)
  }

  /**
   * PATCH /api/v1/admin/delivery/:id/status
   * Controlled state transition machine.
   * Enforces valid transitions, prevents duplicate updates, handles delivered and cancelled states,
   * synchronizes order status, triggers COD payment capture, and restocks inventory on cancellation/return.
   */
  public static async updateDeliveryStatus(
    idOrOrderNumber: string,
    input: UpdateDeliveryStatusInput,
    actor: { id: string; email: string }
  ): Promise<DeliveryDetailResponse> {
    const delivery = await this.resolveDelivery(idOrOrderNumber)
    const currentStatus = delivery.status
    const targetStatus = input.status

    // 1. Cancelled orders cannot be modified
    if (delivery.order.status === OrderStatus.CANCELLED || currentStatus === DeliveryStatus.CANCELLED) {
      throw new BadRequestError('Cannot update delivery status for a cancelled order/delivery')
    }

    // 2. Delivered state is terminal
    if (currentStatus === DeliveryStatus.DELIVERED) {
      throw new BadRequestError('Cannot update delivery status: Order is already DELIVERED (terminal state)')
    }

    // 3. Duplicate update check
    if (currentStatus === targetStatus) {
      throw new BadRequestError(`Duplicate update: Delivery is already in status '${currentStatus}'`)
    }

    // 4. Valid state transition verification
    const allowedTransitions = VALID_DELIVERY_TRANSITIONS[currentStatus] || []
    if (!allowedTransitions.includes(targetStatus)) {
      throw new BadRequestError(
        `Invalid delivery transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions: ${allowedTransitions.join(', ') || 'None (Terminal state)'}`
      )
    }

    // 5. Execute state transition atomically inside transaction
    await prisma.$transaction(async (tx) => {
      const deliveryUpdate: Prisma.DeliveryUpdateInput = {
        status: targetStatus,
      }

      if (input.trackingNumber) {
        deliveryUpdate.trackingNumber = input.trackingNumber
      }
      if (input.courierPartner) {
        deliveryUpdate.courierPartner = input.courierPartner
      }
      if (input.notes) {
        deliveryUpdate.deliveryNotes = delivery.deliveryNotes
          ? `${delivery.deliveryNotes}\n${input.notes}`
          : input.notes
      }

      // Record delivered timestamp if transitioning to DELIVERED
      if (targetStatus === DeliveryStatus.DELIVERED) {
        deliveryUpdate.deliveredAt = new Date()
      }

      // Optimistic concurrency guard: only apply the transition if the row is
      // still in the exact status this request validated against. Two racing
      // transitions (e.g. ASSIGNED -> PACKED and ASSIGNED -> SHIPPED) would
      // otherwise both read ASSIGNED, both pass the state-machine check and both
      // write, silently losing one update and emitting a divergent history.
      const guard = await tx.delivery.updateMany({
        where: { id: delivery.id, status: currentStatus },
        data: deliveryUpdate as unknown as Prisma.DeliveryUpdateManyMutationInput,
      })

      if (guard.count === 0) {
        throw new ConflictError(
          `Delivery status was modified concurrently (expected '${currentStatus}'). Please retry.`
        )
      }

      // Sync Order status
      const mappedOrderStatus = DELIVERY_TO_ORDER_STATUS_MAP[targetStatus]
      if (mappedOrderStatus) {
        const orderUpdate: Prisma.OrderUpdateInput = {
          status: mappedOrderStatus,
          ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
          ...(input.courierPartner ? { courier: input.courierPartner } : {}),
        }

        // When order is delivered:
        // If COD payment, mark payment as PAID and capture payment record
        if (targetStatus === DeliveryStatus.DELIVERED) {
          if (delivery.order.paymentMethod === 'COD' && delivery.order.paymentStatus !== PaymentStatus.PAID) {
            orderUpdate.paymentStatus = PaymentStatus.PAID
            if (delivery.order.payment) {
              await tx.payment.update({
                where: { id: delivery.order.payment.id },
                data: {
                  status: PaymentRecordStatus.CAPTURED,
                  verifiedAt: new Date(),
                },
              })
            }
          }
        }

        await tx.order.update({
          where: { id: delivery.orderId },
          data: orderUpdate,
        })
      }

      // Handle inventory disposition if delivery was CANCELLED or RETURNED.
      // The correct operation depends on how the ORDER holds its stock:
      // an already-deducted order (CONFIRMED..OUT_FOR_DELIVERY) must be restocked
      // back to available; an online order that never got past PENDING_PAYMENT
      // only holds a reservation and must be released (never credited to sold);
      // FAILED/PAYMENT_FAILED and CANCELLED orders already disposed of stock and
      // must be left inert. restockOrder is additionally idempotent per order, so
      // a RETURNED -> CANCELLED follow-up cannot double-credit inventory.
      if (targetStatus === DeliveryStatus.CANCELLED || targetStatus === DeliveryStatus.RETURNED) {
        const orderItems = delivery.order.items
          .filter((item) => Boolean(item.productId))
          .map((item) => ({ productId: item.productId!, quantity: item.quantity }))

        const deductedStatuses: OrderStatus[] = [
          OrderStatus.CONFIRMED,
          OrderStatus.PROCESSING,
          OrderStatus.PACKED,
          OrderStatus.SHIPPED,
          OrderStatus.OUT_FOR_DELIVERY,
        ]
        const alreadyDisposedStatuses: OrderStatus[] = [
          OrderStatus.FAILED,
          OrderStatus.PAYMENT_FAILED,
          OrderStatus.CANCELLED,
        ]

        const currentOrderStatus = delivery.order.status

        if (orderItems.length > 0 && deductedStatuses.includes(currentOrderStatus)) {
          await InventoryService.restockOrder(
            orderItems,
            {
              orderId: delivery.order.id,
              orderNumber: delivery.order.orderNumber,
              actorId: actor.id,
              actorEmail: actor.email,
              reason: `Delivery transitioned to ${targetStatus}: Restocked inventory`,
            },
            tx
          )
        } else if (orderItems.length > 0 && !alreadyDisposedStatuses.includes(currentOrderStatus)) {
          await InventoryService.releaseReservation(
            orderItems,
            {
              orderId: delivery.order.id,
              orderNumber: delivery.order.orderNumber,
              actorId: actor.id,
              actorEmail: actor.email,
              reason: `Delivery transitioned to ${targetStatus}: Released reservation`,
            },
            tx
          )
        }
      }

      // Record delivery history
      await tx.deliveryHistory.create({
        data: {
          deliveryId: delivery.id,
          status: targetStatus,
          actorId: actor.id,
          actorEmail: actor.email,
          notes: input.notes || `Delivery status changed from ${currentStatus} to ${targetStatus}`,
          metadata: {
            fromStatus: currentStatus,
            toStatus: targetStatus,
            trackingNumber: input.trackingNumber || delivery.trackingNumber,
            courierPartner: input.courierPartner || delivery.courierPartner,
          },
        },
      })
    }, { timeout: 30000, maxWait: 15000 })

    await AuditService.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'DELIVERY_STATUS_CHANGED',
      entity: 'Delivery',
      entityId: delivery.id,
      metadata: {
        from: currentStatus,
        to: targetStatus,
        orderNumber: delivery.order.orderNumber,
        notes: input.notes,
      },
    })

    logger.info(
      { deliveryId: delivery.id, from: currentStatus, to: targetStatus, orderNumber: delivery.order.orderNumber },
      'Delivery status updated successfully in accordance with state machine'
    )

    // Customer lifecycle notifications. Best-effort and deduped per
    // (order, phase) so a retried admin action cannot double-send. Emitted
    // after the transaction commits: the state change is authoritative and
    // must never be blocked or rolled back by a mail failure.
    if (targetStatus === DeliveryStatus.SHIPPED) {
      await OrderEmailService.deliveryUpdate(delivery.orderId, 'shipped', `delivery_shipped:${delivery.orderId}`)
    } else if (targetStatus === DeliveryStatus.OUT_FOR_DELIVERY) {
      await OrderEmailService.deliveryUpdate(delivery.orderId, 'out_for_delivery', `delivery_out_for_delivery:${delivery.orderId}`)
    } else if (targetStatus === DeliveryStatus.DELIVERED) {
      await OrderEmailService.deliveryUpdate(delivery.orderId, 'delivered', `delivery_delivered:${delivery.orderId}`)
    } else if (targetStatus === DeliveryStatus.CANCELLED) {
      await OrderEmailService.orderCancelled(delivery.orderId, input.notes || 'Delivery cancelled', `order_cancelled:${delivery.orderId}`)
    }

    return this.getDeliveryById(delivery.id)
  }

  /**
   * Customer delivery tracking endpoint.
   * Enforces strict customer ownership: customers can only view delivery details for their own orders.
   */
  public static async getCustomerDelivery(
    userId: string,
    orderNumberOrId: string,
    userRoles: string[] = [],
    userPermissions: string[] = []
  ): Promise<CustomerDeliveryResponse> {
    const trimmed = orderNumberOrId.trim()

    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { orderNumber: trimmed },
        ],
      },
    })

    if (!order) {
      throw new NotFoundError(`Order '${trimmed}' not found`)
    }

    const isStaffOrAdmin =
      userRoles.includes('ADMIN') ||
      userRoles.includes('OWNER') ||
      userPermissions.includes('delivery.read') ||
      userPermissions.includes('orders.read')

    const isOwner = order.userId === userId

    if (!isOwner && !isStaffOrAdmin) {
      throw new ForbiddenError('You are not authorized to view delivery information for another customer\'s order')
    }

    const delivery = await this.resolveDelivery(order.id)

    const history = await prisma.deliveryHistory.findMany({
      where: { deliveryId: delivery.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        status: true,
        notes: true,
        createdAt: true,
      },
    })

    return {
      orderNumber: order.orderNumber,
      status: delivery.status,
      courierPartner: delivery.courierPartner,
      trackingNumber: delivery.trackingNumber,
      trackingUrl: delivery.trackingUrl,
      estimatedDelivery: delivery.estimatedDelivery,
      deliveredAt: delivery.deliveredAt,
      deliveryNotes: delivery.deliveryNotes,
      recipientName: delivery.recipientName,
      recipientPhone: delivery.recipientPhone,
      shippingAddress: order.shippingAddressSnapshot,
      updatedAt: delivery.updatedAt,
      history,
    }
  }
}
