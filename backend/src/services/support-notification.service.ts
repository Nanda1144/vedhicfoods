import { NotificationDeliveryStatus, Prisma, TicketStatus } from '@prisma/client'
import { prisma } from '../config/database'
import { logger } from '../config/logger'
import { env } from '../config/env'
import { emailTransport } from '../integrations/email/email-transport'

export type SupportNotificationAudience = 'CUSTOMER' | 'STAFF_INBOX'

export interface DispatchSupportEmailParams {
  ticketId?: string | null
  messageId?: string | null
  contactId?: string | null
  recipient: string
  audience: SupportNotificationAudience
  subject: string
  html: string
  text: string
  /**
   * Logical event identity, e.g. `TICKET_MESSAGE_CREATED:<messageId>:CUSTOMER`.
   * Combined with the recipient to form the unique dedupe key that stops
   * duplicate dispatches and email loops at the database level.
   */
  eventKey: string
  /** Email address of whoever triggered the event, never notified. */
  actorEmail?: string | null
  actorIsAutomated?: boolean
}

export interface DispatchResult {
  status: NotificationDeliveryStatus
  dedupeKey: string
  error?: string
}

/**
 * Consecutive failures for a single ticket before email dispatch is suspended.
 * A permanently unreachable mailbox would otherwise be retried on every new
 * message, which is both wasteful and a noise amplifier.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5

function buildDedupeKey(recipient: string, eventKey: string): string {
  return `${eventKey}:${recipient.toLowerCase().trim()}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Outbound support email.
 *
 * Loop prevention is layered so no single mechanism is load bearing:
 *
 *  1. **Never notify the actor.** A staff reply does not email the support
 *     inbox; a customer reply does not email the customer. This alone removes
 *     the classic reply-all ping-pong.
 *  2. **No autoresponders.** Nothing in this service creates SupportMessage
 *     rows, so no email can be turned back into a new message that triggers
 *     another email.
 *  3. **Automated actors are ignored.** Messages flagged `actorIsAutomated`
 *     (webhooks, importers) never fan out to a mailbox.
 *  4. **Unique dedupe key per logical event.** `support_notifications.dedupeKey`
 *     is UNIQUE, so a retried request, a double-clicked button or a replayed
 *     queue job collapses into the existing row instead of sending twice.
 *  5. **Per-ticket circuit breaker.** After repeated failures the ticket's email
 *     dispatch is skipped until the underlying problem is fixed.
 *
 * Dispatch is always best-effort: a mail failure is recorded and never fails the
 * customer's API call.
 */
export class SupportNotificationService {
  /** True when email dispatch for this ticket has been suspended. */
  public static async isSuppressed(ticketId: string): Promise<boolean> {
    const failures = await prisma.supportNotification.count({
      where: { ticketId, status: NotificationDeliveryStatus.FAILED },
    })
    return failures >= CIRCUIT_BREAKER_THRESHOLD
  }

  public static async dispatchEmail(
    params: DispatchSupportEmailParams
  ): Promise<DispatchResult> {
    const dedupeKey = buildDedupeKey(params.recipient, params.eventKey)

    const base = {
      ticketId: params.ticketId ?? null,
      messageId: params.messageId ?? null,
      contactId: params.contactId ?? null,
      recipient: params.recipient.toLowerCase().trim(),
      recipientType: params.audience,
      channel: 'EMAIL',
      dedupeKey,
    }

    // --- Guard 3: automated actors never fan out ---------------------------
    if (params.actorIsAutomated) {
      await SupportNotificationService.record({
        ...base,
        status: NotificationDeliveryStatus.SKIPPED,
        error: 'skipped_automated_actor',
      })
      return { status: NotificationDeliveryStatus.SKIPPED, dedupeKey }
    }

    // --- Guard 1: never email the actor ------------------------------------
    if (
      params.actorEmail &&
      params.actorEmail.toLowerCase().trim() === params.recipient.toLowerCase().trim()
    ) {
      await SupportNotificationService.record({
        ...base,
        status: NotificationDeliveryStatus.SKIPPED,
        error: 'skipped_actor_is_recipient',
      })
      logger.debug(
        { dedupeKey },
        'Support notification suppressed: actor is the recipient (loop guard)'
      )
      return { status: NotificationDeliveryStatus.SKIPPED, dedupeKey }
    }

    // --- Guard 5: circuit breaker ------------------------------------------
    if (params.ticketId && (await SupportNotificationService.isSuppressed(params.ticketId))) {
      await SupportNotificationService.record({
        ...base,
        status: NotificationDeliveryStatus.SKIPPED,
        error: 'skipped_circuit_breaker_open',
      })
      return { status: NotificationDeliveryStatus.SKIPPED, dedupeKey }
    }

    // --- Guard 4: idempotent dispatch --------------------------------------
    // Create the PENDING row first so a concurrent duplicate loses the unique
    // index race instead of sending a second copy of the same notification.
    let notificationId: string
    try {
      const created = await prisma.supportNotification.create({
        data: { ...base, status: NotificationDeliveryStatus.PENDING, attemptCount: 1 },
        select: { id: true },
      })
      notificationId = created.id
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        logger.info({ dedupeKey }, 'Duplicate support notification suppressed (dedupe key)')
        return { status: NotificationDeliveryStatus.SKIPPED, dedupeKey }
      }
      throw err
    }

    try {
      const messageId = await emailTransport.sendTransactionalEmail({
        to: params.recipient,
        subject: params.subject,
        htmlContent: params.html,
        textContent: params.text,
      })

      await prisma.supportNotification.update({
        where: { id: notificationId },
        data: { status: NotificationDeliveryStatus.SENT, sentAt: new Date(), error: null },
      })

      logger.info(
        { dedupeKey, providerMessageId: messageId, audience: params.audience },
        'Support notification dispatched'
      )
      return { status: NotificationDeliveryStatus.SENT, dedupeKey }
    } catch (err: any) {
      const message = err?.message || 'Unknown email dispatch failure'
      await prisma.supportNotification.update({
        where: { id: notificationId },
        data: { status: NotificationDeliveryStatus.FAILED, error: message.slice(0, 500) },
      })
      logger.error({ dedupeKey, err: message }, 'Support notification dispatch failed')
      return { status: NotificationDeliveryStatus.FAILED, dedupeKey, error: message }
    }
  }

  /**
   * Notify the support inbox that a new ticket exists.
   * The submitting customer's address is intentionally not used as a recipient.
   */
  public static async notifyStaffOfNewTicket(params: {
    ticketId: string
    ticketNumber: string
    subject: string
    description: string
    customerName: string
    customerEmail: string
    priority: string
    source: string
    actorEmail?: string | null
    messageId?: string | null
  }): Promise<DispatchResult> {
    const supportInbox = await SupportNotificationService.resolveSupportInbox()

    const safeSubject = escapeHtml(params.subject)
    const safeName = escapeHtml(params.customerName)
    const safeDescription = escapeHtml(params.description).replace(/\n/g, '<br />')

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">
        <h2 style="margin:0 0 12px">New support ticket ${escapeHtml(params.ticketNumber)}</h2>
        <p style="margin:0 0 6px"><strong>From:</strong> ${safeName} &lt;${escapeHtml(params.customerEmail)}&gt;</p>
        <p style="margin:0 0 6px"><strong>Priority:</strong> ${escapeHtml(params.priority)}</p>
        <p style="margin:0 0 6px"><strong>Source:</strong> ${escapeHtml(params.source)}</p>
        <p style="margin:0 0 16px"><strong>Subject:</strong> ${safeSubject}</p>
        <div style="padding:12px 16px;background:#f9fafb;border-left:3px solid #16a34a;border-radius:4px">${safeDescription}</div>
      </div>`

    const text = [
      `New support ticket ${params.ticketNumber}`,
      `From: ${params.customerName} <${params.customerEmail}>`,
      `Priority: ${params.priority}`,
      `Source: ${params.source}`,
      `Subject: ${params.subject}`,
      '',
      params.description,
    ].join('\n')

    return SupportNotificationService.dispatchEmail({
      ticketId: params.ticketId,
      messageId: params.messageId ?? null,
      recipient: supportInbox,
      audience: 'STAFF_INBOX',
      subject: `[${params.ticketNumber}] New ${params.priority} support ticket: ${params.subject}`.slice(0, 200),
      html,
      text,
      eventKey: `TICKET_CREATED:${params.ticketId}`,
      actorEmail: params.actorEmail ?? null,
    })
  }

  /**
   * Notify the customer that staff replied. Only ever called for staff-authored
   * messages, and never addressed to the staff inbox.
   */
  public static async notifyCustomerOfStaffReply(params: {
    ticketId: string
    ticketNumber: string
    messageId: string | null
    eventKey?: string
    subject: string
    message: string
    staffName: string
    customerEmail: string
    status: TicketStatus
    actorEmail?: string | null
  }): Promise<DispatchResult> {
    const safeMessage = escapeHtml(params.message).replace(/\n/g, '<br />')

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">
        <h2 style="margin:0 0 12px">New reply to ticket ${escapeHtml(params.ticketNumber)}</h2>
        <p style="margin:0 0 6px"><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>
        <p style="margin:0 0 6px"><strong>Status:</strong> ${escapeHtml(params.status)}</p>
        <p style="margin:0 0 16px"><strong>From:</strong> ${escapeHtml(params.staffName)}, Vedhic Foods Support</p>
        <div style="padding:12px 16px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px">${safeMessage}</div>
        <p style="margin:20px 0 0;font-size:13px;color:#6b7280">
          Reply to this email or sign in to your account to continue the conversation.
        </p>
      </div>`

    const text = [
      `New reply to ticket ${params.ticketNumber}`,
      `Subject: ${params.subject}`,
      `Status: ${params.status}`,
      `From: ${params.staffName}, Vedhic Foods Support`,
      '',
      params.message,
    ].join('\n')

    return SupportNotificationService.dispatchEmail({
      ticketId: params.ticketId,
      messageId: params.messageId,
      recipient: params.customerEmail,
      audience: 'CUSTOMER',
      subject: `[${params.ticketNumber}] Reply from Vedhic Foods Support`.slice(0, 200),
      html,
      text,
      eventKey: params.eventKey ?? `MESSAGE_CREATED:${params.messageId}`,
      actorEmail: params.actorEmail ?? null,
    })
  }

  /**
   * Notify the support inbox of a customer reply. Only ever called for
   * customer-authored messages.
   */
  public static async notifyStaffOfCustomerReply(params: {
    ticketId: string
    ticketNumber: string
    messageId: string | null
    eventKey?: string
    subject: string
    message: string
    customerName: string
    customerEmail: string
    actorEmail?: string | null
  }): Promise<DispatchResult> {
    const supportInbox = await SupportNotificationService.resolveSupportInbox()

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">
        <h2 style="margin:0 0 12px">Customer reply on ${escapeHtml(params.ticketNumber)}</h2>
        <p style="margin:0 0 6px"><strong>From:</strong> ${escapeHtml(params.customerName)} &lt;${escapeHtml(params.customerEmail)}&gt;</p>
        <p style="margin:0 0 16px"><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>
        <div style="padding:12px 16px;background:#fffbeb;border-left:3px solid #d97706;border-radius:4px">${escapeHtml(params.message).replace(/\n/g, '<br />')}</div>
      </div>`

    const text = [
      `Customer reply on ${params.ticketNumber}`,
      `From: ${params.customerName} <${params.customerEmail}>`,
      `Subject: ${params.subject}`,
      '',
      params.message,
    ].join('\n')

    return SupportNotificationService.dispatchEmail({
      ticketId: params.ticketId,
      messageId: params.messageId,
      recipient: supportInbox,
      audience: 'STAFF_INBOX',
      subject: `[${params.ticketNumber}] Customer reply: ${params.subject}`.slice(0, 200),
      html,
      text,
      eventKey: params.eventKey ?? `MESSAGE_CREATED:${params.messageId}`,
      actorEmail: params.actorEmail ?? null,
    })
  }

  /**
   * Notify the support inbox of a public contact-form submission.
   * Uses a distinct event namespace from tickets so a contact submission and a
   * ticket can never collide on the dedupe key.
   */
  public static async notifyStaffOfContactSubmission(params: {
    contactId: string
    reference: string
    name: string
    email: string
    phone: string | null
    category: string
    subject: string
    message: string
    submittedAt: Date
  }): Promise<DispatchResult> {
    const supportInbox = await SupportNotificationService.resolveSupportInbox()

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.6">
        <h2 style="margin:0 0 12px">New website enquiry ${escapeHtml(params.reference)}</h2>
        <table style="border-collapse:collapse;margin-bottom:16px;font-size:14px">
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Name</td><td>${escapeHtml(params.name)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Email</td><td>${escapeHtml(params.email)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Phone</td><td>${escapeHtml(params.phone || 'Not provided')}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Category</td><td>${escapeHtml(params.category)}</td></tr>
          <tr><td style="padding:2px 12px 2px 0;color:#6b7280">Received</td><td>${params.submittedAt.toISOString()}</td></tr>
        </table>
        <div style="padding:12px 16px;background:#f9fafb;border-left:3px solid #16a34a;border-radius:4px">${escapeHtml(params.message).replace(/\n/g, '<br />')}</div>
      </div>`

    const text = [
      `New website enquiry ${params.reference}`,
      `Name: ${params.name}`,
      `Email: ${params.email}`,
      `Phone: ${params.phone || 'Not provided'}`,
      `Category: ${params.category}`,
      `Received: ${params.submittedAt.toISOString()}`,
      '',
      params.message,
    ].join('\n')

    return SupportNotificationService.dispatchEmail({
      contactId: params.contactId,
      recipient: supportInbox,
      audience: 'STAFF_INBOX',
      subject: `[${params.reference}] Website enquiry: ${params.subject}`.slice(0, 200),
      html,
      text,
      eventKey: `CONTACT_SUBMITTED:${params.contactId}`,
    })
  }

  /** Resolve the mailbox that receives staff notifications. */
  public static async resolveSupportInbox(): Promise<string> {
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'support_email' },
        select: { value: true },
      })
      if (setting?.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setting.value)) {
        return setting.value
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Falling back to configured sender for support inbox')
    }
    return env.ADMIN_NOTIFICATION_EMAIL || env.SES_SENDER_EMAIL || env.BREVO_SENDER_EMAIL
  }

  private static async record(data: {
    ticketId: string | null
    messageId: string | null
    contactId: string | null
    recipient: string
    recipientType: string
    channel: string
    dedupeKey: string
    status: NotificationDeliveryStatus
    error?: string
  }): Promise<void> {
    try {
      await prisma.supportNotification.create({
        data: {
          ticketId: data.ticketId,
          messageId: data.messageId,
          contactId: data.contactId,
          recipient: data.recipient,
          recipientType: data.recipientType,
          channel: data.channel,
          dedupeKey: data.dedupeKey,
          status: data.status,
          error: data.error?.slice(0, 500) ?? null,
          attemptCount: 1,
        },
      })
    } catch (err: any) {
      // Losing a skip-record must never break the request path.
      logger.warn({ dedupeKey: data.dedupeKey, err: err.message }, 'Failed to record notification skip')
    }
  }

  private static async markSent(notificationId: string, note: string): Promise<void> {
    await prisma.supportNotification.update({
      where: { id: notificationId },
      data: { status: NotificationDeliveryStatus.SENT, sentAt: new Date(), error: note },
    })
  }
}
