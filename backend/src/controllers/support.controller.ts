import { Request, Response } from 'express'
import { logger } from '../config/logger'
import { ContactService } from '../services/contact.service'
import {
  getClientIp,
  getUserAgent,
  requireActorContext,
} from '../utils/support-context'
import {
  contactSubmissionSchema,
  CreateTicketDTO,
  TicketReplyDTO,
  CloseTicketDTO,
  ListCustomerTicketsQuery,
  listCustomerTicketsQuerySchema,
  createTicketSchema,
  ticketReplySchema,
  closeTicketSchema,
} from '../types/support.types'
import { SupportService } from '../services/support.service'
import { sendSuccess } from '../utils/api-response'
import { HTTP_STATUS } from '../constants'

/**
 * True when a bot filled the hidden honeypot field.
 *
 * Checked against the raw body rather than the parsed DTO so it works even
 * though the schemas now permit a non-empty value.
 */
function honeypotTriggered(body: unknown): boolean {
  const value = (body as Record<string, unknown> | undefined)?.website
  return typeof value === 'string' && value.trim().length > 0
}

export class ContactController {
  /**
   * POST /api/v1/contact
   *
   * Public contact form. Does not require authentication, but an existing
   * session is used to attribute the submission to a registered account.
   */
  public static async submit(req: Request, res: Response): Promise<void> {
    const parsed = contactSubmissionSchema.safeParse(req.body)

    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }

    const honeypotHit = honeypotTriggered(req.body)

    const actor = req.user
      ? {
          userId: req.user.id,
          email: req.user.email,
          fullName: req.user.fullName || req.user.email,
          isPrivileged: false,
          permissions: req.user.permissions ?? [],
        }
      : undefined

    const result = await ContactService.submit(
      parsed.data,
      {
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        renderedAt: typeof req.body?.renderedAt === 'number' ? req.body.renderedAt : null,
      },
      actor
    )

    if (honeypotHit) {
      // Bots get a indistinguishable success response so the honeypot stays
      // invisible to them and cannot be tuned away.
      logger.warn('Contact honeypot triggered; responding with generic acknowledgement')
      sendSuccess(
        res,
        { reference: `CONTACT-${new Date().getFullYear()}-000000` },
        'Thank you. Your message has been received.',
        HTTP_STATUS.OK
      )
      return
    }

    if (!result.accepted) {
      // Quarantined as spam: acknowledge without confirming the disposition.
      sendSuccess(
        res,
        { reference: result.submission.reference },
        'Thank you. Your message has been received.',
        HTTP_STATUS.OK
      )
      return
    }

    logger.info(
      { reference: result.submission.reference, category: result.submission.category },
      'Public contact submission accepted'
    )

    sendSuccess(
      res,
      {
        reference: result.submission.reference,
        status: result.submission.status,
        submittedAt: result.submission.submittedAt,
      },
      'Thank you for contacting Vedhic Foods. Our team will respond within 1-2 business days.',
      HTTP_STATUS.CREATED
    )
  }
}

export class SupportController {
  /**
   * POST /api/v1/support/tickets
   */
  public static async createTicket(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = createTicketSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }

    const input: CreateTicketDTO = parsed.data

    if (honeypotTriggered(req.body)) {
      // Answer exactly as a real creation would, but persist nothing, so the bot
      // has no feedback loop telling it the honeypot exists.
      logger.warn('Support ticket honeypot triggered; discarding submission')
      sendSuccess(
        res,
        { ticket: { ticketNumber: `TKT-${new Date().getFullYear()}-000000`, status: 'OPEN' } },
        'Support ticket created successfully.',
        HTTP_STATUS.CREATED
      )
      return
    }

    const ticket = await SupportService.createTicket(actor, input)

    sendSuccess(res, { ticket }, 'Support ticket created successfully.', HTTP_STATUS.CREATED)
  }

  /**
   * GET /api/v1/support/tickets
   */
  public static async listMyTickets(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = listCustomerTicketsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid query parameters',
      })
      return
    }

    const result = await SupportService.listCustomerTickets(
      actor,
      parsed.data as ListCustomerTicketsQuery
    )

    res.status(HTTP_STATUS.OK).json({
      success: true,
      count: result.items.length,
      ...result,
    })
  }

  /**
   * GET /api/v1/support/tickets/:id
   */
  public static async getMyTicket(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)
    const ticket = await SupportService.getCustomerTicket(actor, String(req.params.id))
    sendSuccess(res, { ticket }, 'Support ticket retrieved.')
  }

  /**
   * POST /api/v1/support/tickets/:id/messages
   */
  public static async replyToTicket(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = ticketReplySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }

    const input: TicketReplyDTO = parsed.data

    if (honeypotTriggered(req.body)) {
      logger.warn('Support ticket reply honeypot triggered; discarding reply')
      sendSuccess(
        res,
        { ticket: null, message: null, notified: false },
        'Reply added to ticket.'
      )
      return
    }

    const result = await SupportService.replyToTicket(actor, String(req.params.id), input)

    sendSuccess(res, result, 'Reply added to ticket.')
  }

  /**
   * POST /api/v1/support/tickets/:id/close
   */
  public static async closeTicket(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = closeTicketSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Validation failed',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      })
      return
    }

    const input: CloseTicketDTO = parsed.data
    const ticket = await SupportService.closeTicket(actor, String(req.params.id), input)

    sendSuccess(res, { ticket }, 'Ticket closed.')
  }

  /**
   * POST /api/v1/support/tickets/:id/reopen
   */
  public static async reopenTicket(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)
    const ticket = await SupportService.reopenTicket(actor, String(req.params.id))
    sendSuccess(res, { ticket }, 'Ticket reopened.')
  }
}