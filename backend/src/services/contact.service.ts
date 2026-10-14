import { ContactSubmissionStatus, TicketSource, RoleName, NotificationType } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { AuditService } from './audit.service'
import { SpamService } from './spam.service'
import { SupportNotificationService } from './support-notification.service'
import { NotificationCenterService } from './notification-center.service'
import { SupportService, ActorContext } from './support.service'
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors'
import {
  ContactSubmissionDTO,
  ContactSubmissionResponse,
  ListContactSubmissionsQuery,
  TriageContactDTO,
  TICKET_CATEGORIES,
} from '../types/support.types'

export interface ContactRequestContext {
  ipAddress?: string | null
  userAgent?: string | null
  /** Epoch ms of form render, supplied by the client for bot detection. */
  renderedAt?: number | null
}

export interface ContactSubmitResult {
  submission: ContactSubmissionResponse
  /** False when the submission was silently quarantined as spam. */
  accepted: boolean
  ticketId: string | null
}

function formatSubmission(
  row: {
    id: string
    reference: string
    name: string
    email: string
    phone: string | null
    subject: string
    category: string | null
    message: string
    status: ContactSubmissionStatus
    spamScore: number
    spamReasons: string[]
    isSpam: boolean
    userId: string | null
    ticketId: string | null
    submittedAt: Date
    triagedAt: Date | null
    internalNotes: string | null
  },
  options: { includeInternal?: boolean } = {}
): ContactSubmissionResponse {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    email: row.email,
    phone: row.phone,
    subject: row.subject,
    category: row.category,
    message: row.message,
    status: row.status,
    spamScore: row.spamScore,
    spamReasons: row.spamReasons,
    isSpam: row.isSpam,
    userId: row.userId,
    ticketId: row.ticketId,
    submittedAt: row.submittedAt.toISOString(),
    triagedAt: row.triagedAt?.toISOString() ?? null,
    ...(options.includeInternal ? { internalNotes: row.internalNotes } : {}),
  }
}

export class ContactService {
  /**
   * POST /api/v1/contact
   *
   * Public, unauthenticated contact-form submission.
   *
   * A submission flagged as spam is still persisted (so staff can audit the
   * decision and the attacker gains no signal) but is quarantined with status
   * SPAM and never triggers an email.
   */
  public static async submit(
    input: ContactSubmissionDTO,
    ctx: ContactRequestContext,
    actor?: ActorContext
  ): Promise<ContactSubmitResult> {
    const phone = typeof input.phone === 'string' && input.phone.length > 0 ? input.phone : null

    // Attribute the submission to the caller's own account.
    //
    // Only an authenticated session can prove ownership of the address. Matching
    // on the submitted email alone would let anyone attach an inquiry to a
    // stranger's account (and, once staff escalate it, open a ticket in their
    // name), so an anonymous visitor is never linked even when the address is a
    // known account.
    const linkedUserId: string | null = actor?.userId ?? null

    const verdict = await SpamService.evaluate({
      honeypot: input.website,
      text: `${input.subject}\n${input.message}`,
      email: input.email,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      renderedAt: ctx.renderedAt ?? null,
    })

    const reference = await SupportService.allocateContactReference()

    const created = await prisma.contactSubmission.create({
      data: {
        reference,
        name: input.name,
        email: input.email,
        phone,
        subject: input.subject,
        category: input.category,
        message: input.message,
        status: verdict.isSpam ? ContactSubmissionStatus.SPAM : ContactSubmissionStatus.NEW,
        spamScore: verdict.score,
        spamReasons: verdict.reasons,
        isSpam: verdict.isSpam,
        userId: linkedUserId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        submittedAt: new Date(),
      },
    })

    await AuditService.record({
      actorId: linkedUserId,
      actorEmail: input.email,
      action: verdict.isSpam ? 'CONTACT_SUBMISSION_BLOCKED' : 'CONTACT_SUBMISSION_RECEIVED',
      entity: 'ContactSubmission',
      entityId: created.id,
      metadata: {
        reference,
        category: input.category,
        spamScore: verdict.score,
        spamReasons: verdict.reasons,
        hasPhone: Boolean(phone),
      },
    })

    if (verdict.isSpam) {
      logger.warn(
        { reference, spamScore: verdict.score, reasons: verdict.reasons },
        'Contact submission quarantined as spam'
      )
      return {
        submission: formatSubmission(created),
        accepted: false,
        ticketId: null,
      }
    }

    const dispatch = await SupportNotificationService.notifyStaffOfContactSubmission({
      contactId: created.id,
      reference,
      name: created.name,
      email: created.email,
      phone: created.phone,
      category: created.category ?? 'GENERAL',
      subject: created.subject,
      message: created.message,
      submittedAt: created.submittedAt,
    })

    if (dispatch.status === 'SENT') {
      await prisma.contactSubmission.update({
        where: { id: created.id },
        data: { notifiedAt: new Date() },
      })
    } else {
      // Email failed or was suppressed. The inquiry is still safely stored and
      // visible in the staff inbox, so the customer is never silently dropped.
      logger.error(
        { reference, status: dispatch.status, error: dispatch.error },
        'Contact submission stored but staff notification did not send'
      )
    }

    // Mirror the accepted submission into the staff in-app inbox so support can
    // pick it up even when their mail client has no record of it. Deduplicated
    // by contact_id, so a re-submit can never double-notify the same inquiry.
    await NotificationCenterService.broadcastToRoleActors({
      roles: [RoleName.STAFF],
      type: NotificationType.SYSTEM_ALERT,
      title: 'New contact message',
      message: `${created.name} (${created.email}) — ${created.subject ?? created.category ?? 'General inquiry'}`,
      eventKey: `contact_submission:${created.id}`,
      metadata: { contactId: created.id, reference },
    })

    return {
      submission: formatSubmission(created),
      accepted: true,
      ticketId: null,
    }
  }

  /**
   * GET /api/v1/admin/contact-submissions
   * Requires `contacts.read`.
   */
  public static async listSubmissions(
    actor: ActorContext,
    query: ListContactSubmissionsQuery
  ): Promise<{ items: ContactSubmissionResponse[]; pagination: any; counts: Record<string, number> }> {
    ContactService.assertCanManage(actor, 'contacts.read')

    const where = {
      // Spam is hidden by default so the inbox stays actionable.
      ...(query.includeSpam ? {} : { isSpam: false }),
      ...(query.status ? { status: query.status as ContactSubmissionStatus } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
              { subject: { contains: query.search, mode: 'insensitive' as const } },
              { reference: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const [rows, total, grouped] = await Promise.all([
      prisma.contactSubmission.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      prisma.contactSubmission.count({ where }),
      prisma.contactSubmission.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    return {
      items: rows.map((row) => formatSubmission(row, { includeInternal: true })),
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
   * GET /api/v1/admin/contact-submissions/:id
   * Requires `contacts.read`.
   */
  public static async getSubmission(
    actor: ActorContext,
    id: string
  ): Promise<ContactSubmissionResponse> {
    ContactService.assertCanManage(actor, 'contacts.read')
    const row = await prisma.contactSubmission.findUnique({ where: { id } })
    if (!row) throw new NotFoundError('Contact submission not found.')
    return formatSubmission(row, { includeInternal: true })
  }

  /**
   * PATCH /api/v1/admin/contact-submissions/:id
   * Triage a submission: mark TRIAGED/ARCHIVED, annotate, and optionally
   * escalate into a SupportTicket. Every triage action is audited.
   */
  public static async triageSubmission(
    actor: ActorContext,
    id: string,
    input: TriageContactDTO
  ): Promise<ContactSubmissionResponse & { escalatedTicketId: string | null }> {
    ContactService.assertCanManage(actor, 'contacts.manage')

    const existing = await prisma.contactSubmission.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('Contact submission not found.')

    const updated = await prisma.contactSubmission.update({
      where: { id },
      data: {
        status: input.status as ContactSubmissionStatus,
        internalNotes: input.internalNotes ?? existing.internalNotes,
        triagedById: actor.userId,
        triagedAt: new Date(),
      },
    })

    let escalatedTicketId: string | null = null
    if (input.escalateToTicket) {
      const ticket = await SupportService.escalateContactToTicket(id, actor)
      escalatedTicketId = ticket.id
    } else if (input.ticketId) {
      const link = await prisma.supportTicket.findUnique({
        where: { id: input.ticketId },
        select: { id: true },
      })
      if (!link) throw new ValidationError('The referenced ticket could not be found.')
      await prisma.contactSubmission.update({
        where: { id },
        data: { ticketId: link.id },
      })
      escalatedTicketId = link.id
    }

    await AuditService.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'CONTACT_SUBMISSION_TRIAGED',
      entity: 'ContactSubmission',
      entityId: id,
      metadata: {
        reference: existing.reference,
        previousStatus: existing.status,
        newStatus: input.status,
        escalatedTicketId,
        hasInternalNotes: Boolean(input.internalNotes),
      },
    })

    return { ...formatSubmission(updated, { includeInternal: true }), escalatedTicketId }
  }

  /**
   * Actor-side guard. Called by the service so it is enforced even if a future
   * route forgets `requirePermission`.
   *
   * The required permission is a parameter rather than a fixed `contacts.read`
   * because triage is gated on `contacts.manage`: hard-coding the read
   * permission would reject a legitimately-scoped manager at the service layer
   * after the route had already allowed them through.
   */
  private static assertCanManage(actor: ActorContext, permission: string): void {
    const allowed = actor.isPrivileged || actor.permissions.includes(permission)
    if (!allowed) {
      throw new ForbiddenError(`Missing required permission: ${permission}.`)
    }
  }
}

export { TICKET_CATEGORIES, TicketSource }