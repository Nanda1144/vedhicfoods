import { randomInt } from 'node:crypto'
import {
  ContactSubmissionStatus,
  NotificationType,
  Prisma,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { SupportNotificationService } from './support-notification.service'
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors'
import {
  AssignTicketDTO,
  CloseTicketDTO,
  CreateTicketDTO,
  ListCustomerTicketsQuery,
  ListStaffTicketsQuery,
  StaffStatusUpdateDTO,
  SupportMessageResponse,
  SupportTicketResponse,
  TICKET_STATUS_TRANSITIONS,
  TicketReplyDTO,
} from '../types/support.types'

const TICKET_NUMBER_ATTEMPTS = 5
const REFERENCE_NUMBER_ATTEMPTS = 5

/**
 * Messages are always fetched so the formatter has a single type to work with;
 * list endpoints simply omit them from the serialized response to keep payloads
 * small.
 */
const TICKET_INCLUDE = Prisma.validator<Prisma.SupportTicketInclude>()({
  user: { select: { id: true, fullName: true, email: true } },
  assignedStaff: { select: { id: true, fullName: true } },
  messages: {
    include: { sender: { select: { id: true, fullName: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { messages: true } },
})

/**
 * PERFORMANCE: list projections must not expand `messages`.
 *
 * `listCustomerTickets` and `listStaffTickets` render through `formatTicket`
 * with `includeMessages` unset, so the message count comes from
 * `_count.messages` and the message bodies themselves are never read — but both
 * lists were using the detail include above. That cost one extra query per list
 * request returning every message of every ticket on the page, unbounded per
 * ticket, for data that was immediately discarded.
 *
 * Detail paths (`getTicketById`, replies, status changes) still use
 * `TICKET_INCLUDE` because they genuinely need the bodies.
 */
const TICKET_LIST_INCLUDE = Prisma.validator<Prisma.SupportTicketInclude>()({
  user: { select: { id: true, fullName: true, email: true } },
  assignedStaff: { select: { id: true, fullName: true } },
  _count: { select: { messages: true } },
})

type TicketWithRelations = Prisma.SupportTicketGetPayload<{ include: typeof TICKET_INCLUDE }>

export interface ActorContext {
  userId: string
  email: string
  fullName: string
  /** True when the actor holds any privileged role (ADMIN/OWNER). */
  isPrivileged: boolean
  permissions: string[]
  isAutomated?: boolean
}

function hasPermission(actor: ActorContext, permission: string): boolean {
  return actor.isPrivileged || actor.permissions.includes(permission)
}

/**
 * Staff-only working notes. `metadata.visibleToCustomer === false` is the
 * authoritative marker.
 *
 * Anything unmarked defaults to customer-visible on purpose: a new message kind
 * must fail open for the customer rather than silently disappear, and the
 * marker is only ever set explicitly by the staff status endpoint.
 */
function isInternalNote(message: { metadata: unknown }): boolean {
  if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
    return false
  }
  return (message.metadata as Record<string, unknown>).visibleToCustomer === false
}

/**
 * Builds a human-facing reference such as `TKT-2026-004217`.
 * The random component keeps concurrent writers from colliding, and the caller
 * retries on the unique-index violation rather than relying on a count-based
 * sequence that two processes could both observe identically.
 */
function buildReference(prefix: string): string {
  const year = new Date().getFullYear()
  const suffix = randomInt(100000, 1000000)
  return `${prefix}-${year}-${suffix}`
}

export class SupportService {
  // ========================================
  // FORMATTING
  // ========================================

  private static formatMessage(
    message: TicketWithRelations['messages'][number]
  ): SupportMessageResponse {
    return {
      id: message.id,
      ticketId: message.ticketId,
      senderId: message.senderId,
      senderName: message.sender?.fullName,
      senderRole: message.sender?.role,
      message: message.message,
      isStaff: message.isStaff,
      createdAt: message.createdAt.toISOString(),
    }
  }

  public static formatTicket(
    // Accepts either the detail payload (with `messages`) or the list payload
    // (counts only). List endpoints deliberately do not load message bodies —
    // they would be discarded — so the parameter type must not require them.
    ticket: Omit<TicketWithRelations, 'messages'> & { messages?: TicketWithRelations['messages'] },
    options: { includeMessages?: boolean; audience?: 'CUSTOMER' | 'STAFF' } = {}
  ): SupportTicketResponse {
    const audience = options.audience ?? 'STAFF'

    // Internal notes are stripped before serialisation rather than filtered by the
    // caller, so no customer-facing code path can leak them by forgetting a check.
    // Detail responses have messages loaded; list responses fall back to the
    // aggregate count, and cannot be asked for bodies they do not have.
    const loadedMessages = ticket.messages ?? []
    const visibleMessages = audience === 'CUSTOMER' ? loadedMessages.filter((entry) => !isInternalNote(entry)) : loadedMessages

    const messageCount =
      audience === 'CUSTOMER'
        ? visibleMessages.length
        : (ticket._count?.messages ?? visibleMessages.length)

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      userId: ticket.userId,
      customerName: ticket.user?.fullName,
      customerEmail: ticket.user?.email,
      assignedStaffId: ticket.assignedStaffId,
      assignedStaffName: ticket.assignedStaff?.fullName ?? null,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      source: ticket.source,
      category: ticket.category,
      resolution: ticket.resolution,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      closeReason: ticket.closeReason,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      reopenedCount: ticket.reopenedCount,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      messageCount,
      ...(options.includeMessages
        ? { messages: visibleMessages.map(SupportService.formatMessage) }
        : {}),
    }
  }

  private static ticketInclude() {
    return TICKET_INCLUDE
  }

  /**
   * Assigns a customer-facing reference, retrying on unique collisions.
   */
  private static async allocateTicketNumber(): Promise<string> {
    for (let attempt = 1; attempt <= TICKET_NUMBER_ATTEMPTS; attempt++) {
      const ticketNumber = buildReference('TKT')
      const clash = await prisma.supportTicket.findUnique({
        where: { ticketNumber },
        select: { id: true },
      })
      if (!clash) return ticketNumber
      logger.warn({ ticketNumber, attempt }, 'Ticket number collision, retrying')
    }
    throw new ConflictError('Unable to allocate a unique ticket number. Please retry.')
  }

  // ========================================
  // TICKET CREATION
  // ========================================

  /**
   * POST /api/v1/support/tickets
   * Creates a ticket owned by the authenticated customer.
   */
  public static async createTicket(
    actor: ActorContext,
    input: CreateTicketDTO
  ): Promise<SupportTicketResponse> {
    // A customer must never be able to reference somebody else's order.
    if (input.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, userId: true },
      })
      if (!order || order.userId !== actor.userId) {
        throw new NotFoundError('The referenced order could not be found.')
      }
    }

    const ticket = await prisma.$transaction(async (tx) => {
      const ticketNumber = await SupportService.allocateTicketNumber()

      const created = await tx.supportTicket.create({
        data: {
          ticketNumber,
          userId: actor.userId,
          subject: input.subject,
          description: input.description,
          category: input.category,
          priority: input.priority,
          status: TicketStatus.OPEN,
          source: TicketSource.PORTAL,
          lastMessageAt: new Date(),
        },
      })

      await tx.supportMessage.create({
        data: {
          ticketId: created.id,
          senderId: actor.userId,
          message: input.description,
          isStaff: false,
          metadata: { kind: 'initial_description' },
        },
      })

      // Staff who raise a ticket from the admin console own it by default.
      if (actor.isPrivileged || hasPermission(actor, 'support.read')) {
        const actorAccount = await tx.user.findUnique({
          where: { id: actor.userId },
          select: { role: true, isActive: true, isDeleted: true },
        })
        const ownsIt =
          actorAccount?.isActive === true &&
          actorAccount.isDeleted === false &&
          (actorAccount.role === 'OWNER' ||
            actorAccount.role === 'ADMIN' ||
            actorAccount.role === 'STAFF')

        if (ownsIt) {
          await tx.supportTicket.update({
            where: { id: created.id },
            data: { assignedStaffId: actor.userId },
          })
        }
      }

      return tx.supportTicket.findUniqueOrThrow({
        where: { id: created.id },
        include: SupportService.ticketInclude(),
      })
    })

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SUPPORT_TICKET_CREATED',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        category: ticket.category,
        priority: ticket.priority,
        source: ticket.source,
      },
    })

    await SupportNotificationService.notifyStaffOfNewTicket({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      description: ticket.description,
      customerName: actor.fullName,
      customerEmail: actor.email,
      priority: ticket.priority,
      source: ticket.source,
      actorEmail: actor.email,
    })

    return SupportService.formatTicket(ticket, { includeMessages: true })
  }

  /**
   * Create a ticket on behalf of a contact-form submitter during triage.
   * Used by the staff escalation path, never exposed to customers directly.
   */
  public static async createTicketForUser(params: {
    userId: string
    userName: string
    userEmail: string
    subject: string
    description: string
    category?: string | null
    priority?: TicketPriority
    source: TicketSource
    contactId?: string | null
    actor: ActorContext
  }): Promise<SupportTicketResponse> {
    const ticket = await prisma.$transaction(async (tx) => {
      const ticketNumber = await SupportService.allocateTicketNumber()

      const created = await tx.supportTicket.create({
        data: {
          ticketNumber,
          userId: params.userId,
          subject: params.subject,
          description: params.description,
          category: params.category ?? null,
          priority: params.priority ?? TicketPriority.MEDIUM,
          status: TicketStatus.OPEN,
          source: params.source,
          lastMessageAt: new Date(),
        },
      })

      await tx.supportMessage.create({
        data: {
          ticketId: created.id,
          senderId: params.userId,
          message: params.description,
          isStaff: false,
          metadata: { kind: 'initial_description', contactId: params.contactId ?? undefined },
        },
      })

      if (params.contactId) {
        await tx.contactSubmission.update({
          where: { id: params.contactId },
          data: { ticketId: created.id },
        })
      }

      return tx.supportTicket.findUniqueOrThrow({
        where: { id: created.id },
        include: SupportService.ticketInclude(),
      })
    })

    await AuditService.record({
      actorId: params.actor.userId,
      actorEmail: params.actor.email,
      action: 'SUPPORT_TICKET_ESCALATED',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        contactId: params.contactId,
        fromUserId: params.userId,
      },
    })

    await SupportNotificationService.notifyStaffOfNewTicket({
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      description: ticket.description,
      customerName: params.userName,
      customerEmail: params.userEmail,
      priority: ticket.priority,
      source: ticket.source,
      actorEmail: params.actor.email,
    })

    return SupportService.formatTicket(ticket, { includeMessages: true })
  }

  // ========================================
  // CUSTOMER-FACING READ
  // ========================================

  /**
   * Loads a ticket only if the caller owns it, unless the caller is privileged
   * or holds `support.read`.
   *
   * Ownership failures raise NotFoundError rather than ForbiddenError on
   * purpose: returning 403 would confirm the ticket exists and let a customer
   * enumerate other customers' support references.
   */
  private static async loadTicketForActor(
    actor: ActorContext,
    ticketId: string,
    options: { staffPermission?: string } = {}
  ): Promise<TicketWithRelations> {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: SupportService.ticketInclude(),
    })

    if (!ticket) {
      throw new NotFoundError('Support ticket not found.')
    }

    const canAccessOthers = hasPermission(actor, options.staffPermission ?? 'support.read')

    if (ticket.userId !== actor.userId && !canAccessOthers) {
      logger.warn(
        { actorId: actor.userId, requestedTicketId: ticketId },
        'Cross-customer support ticket access denied'
      )
      throw new NotFoundError('Support ticket not found.')
    }

    return ticket
  }

  /**
   * GET /api/v1/support/tickets
   * Strictly scoped to the authenticated customer's own tickets.
   */
  public static async listCustomerTickets(
    actor: ActorContext,
    query: ListCustomerTicketsQuery
  ): Promise<{ items: SupportTicketResponse[]; pagination: any }> {
    const where: Prisma.SupportTicketWhereInput = {
      // The single most important line in this method: the owner filter is
      // applied unconditionally and cannot be widened by query parameters.
      userId: actor.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { ticketNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: TICKET_LIST_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      prisma.supportTicket.count({ where }),
    ])

    return {
      items: rows.map((ticket) => SupportService.formatTicket(ticket)),
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.ceil(total / query.perPage),
      },
    }
  }

  /**
   * GET /api/v1/support/tickets/:id
   */
  public static async getCustomerTicket(
    actor: ActorContext,
    ticketId: string
  ): Promise<SupportTicketResponse> {
    const ticket = await SupportService.loadTicketForActor(actor, ticketId)

    // A staff member with `support.read` is allowed in, but internal notes stay
    // staff-only on the customer-facing representation regardless of who asked.
    const audience = hasPermission(actor, 'support.read') ? 'STAFF' : 'CUSTOMER'

    return SupportService.formatTicket(ticket, { includeMessages: true, audience })
  }

  // ========================================
  // REPLIES
  // ========================================

  /**
   * POST /api/v1/support/tickets/:id/messages
   *
   * Customers reply on their own tickets. Staff reply when they hold
   * `support.reply`. A CLOSED ticket rejects new replies unless the actor is
   * privileged, so the conversation cannot be resurrected silently.
   */
  public static async replyToTicket(
    actor: ActorContext,
    ticketId: string,
    input: TicketReplyDTO
  ): Promise<{ ticket: SupportTicketResponse; message: SupportMessageResponse; notified: boolean }> {
    const ticket = await SupportService.loadTicketForActor(actor, ticketId, {
      staffPermission: 'support.reply',
    })

    // A plain customer may always reply on their own ticket. Anyone else needs
    // `support.reply`; privileged roles bypass the granular check.
    const actorIsStaff = actor.isPrivileged || hasPermission(actor, 'support.reply')
    const replyingToOwnTicket = ticket.userId === actor.userId

    if (!actorIsStaff && !replyingToOwnTicket) {
      throw new ForbiddenError('You are not permitted to reply to support tickets.')
    }

    if (ticket.status === TicketStatus.CLOSED && !actorIsStaff) {
      throw new ConflictError(
        'This ticket is closed. Please open a new ticket or contact support to continue.'
      )
    }

    const now = new Date()

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          senderId: actor.userId,
          message: input.message,
          isStaff: actorIsStaff,
          metadata: actorIsStaff ? { kind: 'staff_reply' } : { kind: 'customer_reply' },
        },
      })

      // A customer replying to a RESOLVED ticket implicitly reopens it.
      // WAITING_FOR_CUSTOMER is cleared because the customer has now answered.
      const patch: Prisma.SupportTicketUpdateInput = {
        lastMessageAt: now,
      }

      if (actorIsStaff) {
        if (ticket.status === TicketStatus.OPEN) {
          patch.status = TicketStatus.IN_PROGRESS
        }
        if (ticket.status === TicketStatus.WAITING_FOR_CUSTOMER) {
          patch.status = TicketStatus.IN_PROGRESS
        }
        if (!ticket.firstResponseAt) {
          patch.firstResponseAt = now
        }
      } else {
        if (ticket.status === TicketStatus.WAITING_FOR_CUSTOMER) {
          patch.status = TicketStatus.IN_PROGRESS
        }
        if (ticket.status === TicketStatus.RESOLVED) {
          patch.status = TicketStatus.IN_PROGRESS
          patch.resolvedAt = null
          patch.resolution = null
        }
      }

      await tx.supportTicket.update({ where: { id: ticket.id }, data: patch })

      // Staff get an in-app notification when a customer replies.
      if (!actorIsStaff && ticket.assignedStaffId) {
        await tx.notification.create({
          data: {
            userId: ticket.assignedStaffId,
            type: NotificationType.SUPPORT_UPDATE,
            title: `Customer reply on ${ticket.ticketNumber}`,
            message: input.message.slice(0, 240),
            eventKey: `support_customer_reply:${created.id}`,
            metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
          },
        })
      }

      // Customer gets an in-app notification when a staff member replies.
      if (actorIsStaff) {
        await tx.notification.create({
          data: {
            userId: ticket.userId,
            type: NotificationType.SUPPORT_UPDATE,
            title: `Staff reply on ${ticket.ticketNumber}`,
            message: input.message.slice(0, 240),
            eventKey: `support_staff_reply:${created.id}`,
            metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
          },
        })
      }

      return created
    })

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: actorIsStaff ? 'SUPPORT_TICKET_STAFF_REPLY' : 'SUPPORT_TICKET_CUSTOMER_REPLY',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: { ticketNumber: ticket.ticketNumber, messageId: message.id },
    })

    // Fan out to exactly one mailbox, never both and never the actor.
    const dispatch = actorIsStaff
      ? await SupportNotificationService.notifyCustomerOfStaffReply({
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          messageId: message.id,
          subject: ticket.subject,
          message: input.message,
          staffName: actor.fullName,
          customerEmail: ticket.user?.email ?? '',
          status: ticket.status,
          actorEmail: actor.email,
        })
      : await SupportNotificationService.notifyStaffOfCustomerReply({
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          messageId: message.id,
          subject: ticket.subject,
          message: input.message,
          customerName: actor.fullName,
          customerEmail: actor.email,
          actorEmail: actor.email,
        })

    const refreshed = await prisma.supportTicket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: SupportService.ticketInclude(),
    })

    // Read the freshly persisted row (with its sender relation) rather than
    // reconstructing it, so the response is exactly what a follow-up GET returns.
    const persistedMessage =
      refreshed.messages.find((entry) => entry.id === message.id) ?? refreshed.messages.at(-1)

    return {
      ticket: SupportService.formatTicket(refreshed, {
        includeMessages: true,
        audience: actorIsStaff ? 'STAFF' : 'CUSTOMER',
      }),
      message: persistedMessage
        ? SupportService.formatMessage(persistedMessage)
        : {
            id: message.id,
            ticketId: message.ticketId,
            senderId: message.senderId,
            senderName: actor.fullName,
            message: message.message,
            isStaff: message.isStaff,
            createdAt: message.createdAt.toISOString(),
          },
      notified: dispatch.status === 'SENT',
    }
  }

  // ========================================
  // CLOSE / REOPEN
  // ========================================

  /**
   * POST /api/v1/support/tickets/:id/close
   * A customer may close their own ticket at any time.
   */
  public static async closeTicket(
    actor: ActorContext,
    ticketId: string,
    input: CloseTicketDTO
  ): Promise<SupportTicketResponse> {
    const actorIsStaff = actor.isPrivileged || hasPermission(actor, 'support.close')
    const ticket = await SupportService.loadTicketForActor(actor, ticketId, {
      staffPermission: 'support.close',
    })

    if (ticket.status === TicketStatus.CLOSED) {
      throw new ConflictError('This ticket is already closed.')
    }

    const now = new Date()

    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.CLOSED,
        closedAt: now,
        closedById: actor.userId,
        closeReason: input.reason,
        resolvedAt: ticket.resolvedAt ?? now,
        resolution: ticket.resolution ?? `Closed by ${actorIsStaff ? 'support agent' : 'customer'}.`,
      },
      include: SupportService.ticketInclude(),
    })

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: actorIsStaff ? 'SUPPORT_TICKET_CLOSED_BY_STAFF' : 'SUPPORT_TICKET_CLOSED_BY_CUSTOMER',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        previousStatus: ticket.status,
        newStatus: TicketStatus.CLOSED,
        reason: input.reason,
      },
    })

    // Notify the counterpart so the closure is not silent.
    if (actorIsStaff) {
      await SupportNotificationService.notifyCustomerOfStaffReply({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        messageId: null,
        eventKey: `TICKET_CLOSED:${ticket.id}:${now.getTime()}`,
        subject: ticket.subject,
        message: `This ticket has been closed. Reason: ${input.reason}`,
        staffName: actor.fullName,
        customerEmail: ticket.user?.email ?? '',
        status: TicketStatus.CLOSED,
        actorEmail: actor.email,
      })
    } else {
      await SupportNotificationService.notifyStaffOfCustomerReply({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        messageId: null,
        eventKey: `TICKET_CLOSED:${ticket.id}:${now.getTime()}`,
        subject: ticket.subject,
        message: `Customer closed this ticket. Reason: ${input.reason}`,
        customerName: actor.fullName,
        customerEmail: actor.email,
        actorEmail: actor.email,
      })
    }

    return SupportService.formatTicket(updated, {
      includeMessages: true,
      audience: actorIsStaff ? 'STAFF' : 'CUSTOMER',
    })
  }

  /**
   * POST /api/v1/support/tickets/:id/reopen
   */
  public static async reopenTicket(
    actor: ActorContext,
    ticketId: string
  ): Promise<SupportTicketResponse> {
    const actorIsStaff = actor.isPrivileged || hasPermission(actor, 'support.close')
    const ticket = await SupportService.loadTicketForActor(actor, ticketId, {
      staffPermission: 'support.close',
    })

    if (ticket.status !== TicketStatus.CLOSED) {
      throw new ConflictError('Only closed tickets can be reopened.')
    }

    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.OPEN,
        closedAt: null,
        closedById: null,
        closeReason: null,
        reopenedCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
      include: SupportService.ticketInclude(),
    })

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SUPPORT_TICKET_REOPENED',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        previousStatus: ticket.status,
        newStatus: TicketStatus.OPEN,
        reopenedCount: updated.reopenedCount,
        actorType: actorIsStaff ? 'STAFF' : 'CUSTOMER',
      },
    })

    return SupportService.formatTicket(updated, {
      includeMessages: true,
      audience: actorIsStaff ? 'STAFF' : 'CUSTOMER',
    })
  }

  // ========================================
  // STAFF OPERATIONS
  // ========================================

  /**
   * GET /api/v1/admin/support/tickets
   * Requires `support.read`. Route layer already enforced it; re-checked here so
   * the service is safe to call directly.
   */
  /**
 * Aggregate counts for the staff inbox dashboard.
 *
 * PERFORMANCE: `GET /admin/support/overview` used to call `listStaffTickets`
 * once per priority just to read `.pagination.total`, discarding the rows it had
 * fetched — 5 calls x 3 queries = 15 round trips, plus an unfiltered `groupBy`
 * inside each, at a serial critical-path depth of 5. It now issues 6 aggregate
 * queries in a single `Promise.all` (depth 1) and no row payloads at all.
 */
public static async getStaffOverview(actor: ActorContext) {
    if (!hasPermission(actor, 'support.read')) {
      throw new ForbiddenError('Missing required permission: support.read.')
    }

    // Open work only — a closed ticket is not "in the inbox".
    const openWhere: Prisma.SupportTicketWhereInput = { status: { not: 'CLOSED' } }

    const [byStatus, urgent, high, medium, low, unassignedOpen] = await Promise.all([
      prisma.supportTicket.groupBy({
        by: ['status'],
        where: openWhere,
        _count: { _all: true },
      }),
      prisma.supportTicket.count({ where: { ...openWhere, priority: 'URGENT' } }),
      prisma.supportTicket.count({ where: { ...openWhere, priority: 'HIGH' } }),
      prisma.supportTicket.count({ where: { ...openWhere, priority: 'MEDIUM' } }),
      prisma.supportTicket.count({ where: { ...openWhere, priority: 'LOW' } }),
      prisma.supportTicket.count({ where: { ...openWhere, assignedStaffId: null } }),
    ])

    const counts: Record<string, number> = {}
    for (const row of byStatus) {
      counts[row.status] = row._count._all
    }

    return {
      byStatus: counts,
      openByPriority: [
        { priority: 'URGENT', count: urgent },
        { priority: 'HIGH', count: high },
        { priority: 'MEDIUM', count: medium },
        { priority: 'LOW', count: low },
      ],
      unassignedOpen,
      generatedAt: new Date().toISOString(),
    }
  }

  public static async listStaffTickets(
    actor: ActorContext,
    query: ListStaffTicketsQuery
  ): Promise<{ items: SupportTicketResponse[]; pagination: any; counts: Record<string, number> }> {
    if (!hasPermission(actor, 'support.read')) {
      throw new ForbiddenError('Missing required permission: support.read.')
    }

    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.assignedToMe !== undefined
        ? { assignedStaffId: query.assignedToMe ? actor.userId : null }
        : query.assignedStaffId
          ? { assignedStaffId: query.assignedStaffId }
          : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' } },
              { ticketNumber: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { user: { email: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [rows, total, grouped] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        include: TICKET_LIST_INCLUDE,
        orderBy: [{ priority: 'desc' }, { lastMessageAt: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      prisma.supportTicket.count({ where }),
      // CORRECTNESS: this `groupBy` previously had no `where` clause at all, so
      // the status badges shown above a filtered list reported global counts
      // across the whole ticket table and silently ignored the status, priority,
      // assignee, date and search filters the user had applied.
      prisma.supportTicket.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
    ])

    return {
      items: rows.map((ticket) => SupportService.formatTicket(ticket)),
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.ceil(total / query.perPage),
      },
      counts: grouped.reduce<Record<string, number>>((acc, group) => {
        acc[group.status] = group._count._all
        return acc
      }, {}),
    }
  }

  /**
   * GET /api/v1/admin/support/tickets/:id
   */
  public static async getStaffTicket(
    actor: ActorContext,
    ticketId: string
  ): Promise<SupportTicketResponse> {
    if (!hasPermission(actor, 'support.read')) {
      throw new ForbiddenError('Missing required permission: support.read.')
    }
    const ticket = await SupportService.loadTicketForActor(actor, ticketId, {
      staffPermission: 'support.read',
    })
    return SupportService.formatTicket(ticket, { includeMessages: true })
  }

  /**
   * PATCH /api/v1/admin/support/tickets/:id/status
   *
   * Every administrative status change is written to the audit trail with the
   * before/after values, the acting staff member and the supplied reason.
   */
  public static async updateTicketStatus(
    actor: ActorContext,
    ticketId: string,
    input: StaffStatusUpdateDTO
  ): Promise<SupportTicketResponse> {
    if (!hasPermission(actor, 'support.update')) {
      throw new ForbiddenError('Missing required permission: support.update.')
    }

    const ticket = await SupportService.loadTicketForActor(actor, ticketId, {
      staffPermission: 'support.update',
    })

    const previousStatus = ticket.status

    if (previousStatus === input.status) {
      throw new ConflictError(`Ticket is already in status ${input.status}.`)
    }

    const allowed = TICKET_STATUS_TRANSITIONS[previousStatus]
    if (!allowed.includes(input.status)) {
      throw new ValidationError(
        `Illegal ticket status transition from ${previousStatus} to ${input.status}. Allowed: ${allowed.join(', ')}.`
      )
    }

    const now = new Date()

    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.SupportTicketUpdateInput = {
        status: input.status,
      }

      if (input.priority) data.priority = input.priority

      if (input.resolution !== undefined) data.resolution = input.resolution

      if (input.status === TicketStatus.RESOLVED) {
        data.resolvedAt = now
      } else if (previousStatus === TicketStatus.RESOLVED) {
        data.resolvedAt = null
      }

      if (input.status === TicketStatus.CLOSED) {
        data.closedAt = now
        data.closedById = actor.userId
        data.closeReason = input.closeReason ?? null
        if (!ticket.resolvedAt) data.resolvedAt = now
      } else {
        data.closedAt = null
        data.closedById = null
        data.closeReason = null
      }

      if (previousStatus === TicketStatus.CLOSED) {
        data.reopenedCount = { increment: 1 }
      }

      if (input.status === TicketStatus.IN_PROGRESS && !ticket.firstResponseAt) {
        data.firstResponseAt = now
      }

      await tx.supportTicket.update({ where: { id: ticket.id }, data })

      if (input.internalNote) {
        await tx.supportMessage.create({
          data: {
            ticketId: ticket.id,
            senderId: actor.userId,
            message: input.internalNote,
            isStaff: true,
            metadata: { kind: 'internal_note', visibleToCustomer: false },
          },
        })
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: { lastMessageAt: now },
        })
      }

      return tx.supportTicket.findUniqueOrThrow({
        where: { id: ticket.id },
        include: SupportService.ticketInclude(),
      })
    })

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SUPPORT_TICKET_STATUS_CHANGED',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        previousStatus,
        newStatus: input.status,
        previousPriority: ticket.priority,
        newPriority: input.priority ?? ticket.priority,
        resolution: input.resolution ?? null,
        closeReason: input.closeReason ?? null,
        hasInternalNote: Boolean(input.internalNote),
        actorRole: actor.isPrivileged ? 'PRIVILEGED' : 'STAFF',
        reason: input.reason ?? null,
      },
    })

    // Only meaningful transitions notify the customer; internal routing does not.
    const customerVisibleStatuses: TicketStatus[] = [
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
      TicketStatus.WAITING_FOR_CUSTOMER,
    ]

    if (customerVisibleStatuses.includes(input.status)) {
      await SupportNotificationService.notifyCustomerOfStaffReply({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        messageId: null,
        eventKey: `TICKET_STATUS:${ticket.id}:${now.getTime()}`,
        subject: ticket.subject,
        message:
          input.status === TicketStatus.WAITING_FOR_CUSTOMER
            ? 'Our support team needs more information from you to continue.'
            : input.resolution ?? input.closeReason ?? `Ticket status updated to ${input.status}.`,
        staffName: actor.fullName,
        customerEmail: ticket.user?.email ?? '',
        status: input.status,
        actorEmail: actor.email,
      })
    }

    return SupportService.formatTicket(updated, { includeMessages: true })
  }

  /**
   * PATCH /api/v1/admin/support/tickets/:id/assign
   * Requires `support.assign`.
   */
  public static async assignTicket(
    actor: ActorContext,
    ticketId: string,
    input: AssignTicketDTO
  ): Promise<SupportTicketResponse> {
    if (!hasPermission(actor, 'support.assign')) {
      throw new ForbiddenError('Missing required permission: support.assign.')
    }

    const ticket = await SupportService.loadTicketForActor(actor, ticketId, {
      staffPermission: 'support.assign',
    })

    if (input.assignedStaffId) {
      const assignee = await prisma.user.findUnique({
        where: { id: input.assignedStaffId },
        select: { id: true, role: true, isActive: true, isDeleted: true, fullName: true },
      })

      if (!assignee || assignee.isDeleted || !assignee.isActive) {
        throw new NotFoundError('The selected staff member could not be found.')
      }

      // Refuse to hand a ticket to somebody who cannot actually work it.
      if (assignee.role !== 'OWNER' && assignee.role !== 'ADMIN' && assignee.role !== 'STAFF') {
        throw new ValidationError(
          'Support tickets can only be assigned to staff, admin or owner accounts.'
        )
      }
    }

    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { assignedStaffId: input.assignedStaffId ?? null },
      include: SupportService.ticketInclude(),
    })

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'SUPPORT_TICKET_ASSIGNED',
      entity: 'SupportTicket',
      entityId: ticket.id,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        previousAssigneeId: ticket.assignedStaffId,
        newAssigneeId: input.assignedStaffId ?? null,
      },
    })

    return SupportService.formatTicket(updated)
  }

  /**
   * GET /api/v1/admin/support/tickets/:id/notifications
   * Notification audit trail, including skipped dispatches. Requires support.read.
   */
  public static async listTicketNotifications(actor: ActorContext, ticketId: string) {
    if (!hasPermission(actor, 'support.read')) {
      throw new ForbiddenError('Missing required permission: support.read.')
    }

    await SupportService.loadTicketForActor(actor, ticketId, { staffPermission: 'support.read' })

    const notifications = await prisma.supportNotification.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return {
      ticketId,
      total: notifications.length,
      items: notifications.map((n) => ({
        id: n.id,
        recipient: n.recipient,
        recipientType: n.recipientType,
        channel: n.channel,
        status: n.status,
        error: n.error,
        dedupeKey: n.dedupeKey,
        messageId: n.messageId,
        sentAt: n.sentAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    }
  }

  // ========================================
  // CONTACT SUBMISSION SUPPORT
  // ========================================

  /**
   * Allocates a public reference such as `CONTACT-2026-005512`.
   */
  public static async allocateContactReference(): Promise<string> {
    for (let attempt = 1; attempt <= REFERENCE_NUMBER_ATTEMPTS; attempt++) {
      const reference = buildReference('CONTACT')
      const clash = await prisma.contactSubmission.findUnique({
        where: { reference },
        select: { id: true },
      })
      if (!clash) return reference
    }
    throw new ConflictError('Unable to allocate a unique reference. Please retry.')
  }

  /** Escalation helper used by the staff triage endpoint. */
  public static async escalateContactToTicket(
    contactId: string,
    actor: ActorContext
  ): Promise<SupportTicketResponse> {
    const contact = await prisma.contactSubmission.findUnique({
      where: { id: contactId },
    })

    if (!contact) throw new NotFoundError('Contact submission not found.')
    if (contact.ticketId) throw new ConflictError('This submission already has a linked ticket.')
    if (contact.isSpam) throw new ValidationError('Spam submissions cannot be escalated.')

    if (!contact.userId) {
      throw new ValidationError(
        'The submitter has no registered account. Ask them to register with this email address first.'
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: contact.userId },
      select: { id: true, fullName: true, email: true },
    })

    if (!user) {
      throw new ValidationError('The linked customer account no longer exists.')
    }

    return SupportService.createTicketForUser({
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      subject: contact.subject,
      description: contact.message,
      category: contact.category,
      source: TicketSource.CONTACT_FORM,
      contactId: contact.id,
      actor,
    })
  }

  /** Statuses used by the staff contact inbox. */
  public static get contactStatuses(): readonly ContactSubmissionStatus[] {
    return [
      ContactSubmissionStatus.NEW,
      ContactSubmissionStatus.TRIAGED,
      ContactSubmissionStatus.SPAM,
      ContactSubmissionStatus.ARCHIVED,
    ]
  }

  /** Throws when a ticket status value is not part of the supported set. */
  public static assertKnownStatus(status: string): TicketStatus {
    if (!Object.values(TicketStatus).includes(status as TicketStatus)) {
      throw new BadRequestError(`Unsupported ticket status: ${status}`)
    }
    return status as TicketStatus
  }
}
