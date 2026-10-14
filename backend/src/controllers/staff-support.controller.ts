import { Request, Response } from 'express'
import { logger } from '../config/logger'
import { SupportService } from '../services/support.service'
import { ContactService } from '../services/contact.service'
import { sendSuccess } from '../utils/api-response'
import { requireActorContext } from '../utils/support-context'
import { HTTP_STATUS } from '../constants'
import {
  assignTicketSchema,
  listContactSubmissionsQuerySchema,
  ListContactSubmissionsQuery,
  listStaffTicketsQuerySchema,
  ListStaffTicketsQuery,
  staffStatusUpdateSchema,
  StaffStatusUpdateDTO,
  ticketReplySchema,
  triageContactSchema,
  TriageContactDTO,
  AssignTicketDTO,
} from '../types/support.types'

/**
 * Staff-facing support console API.
 * Permission enforcement lives in the route layer via `requirePermission` and is
 * re-asserted inside SupportService / ContactService so the services stay safe
 * when invoked outside HTTP.
 */
export class StaffSupportController {
  /**
   * GET /api/v1/admin/support/tickets
   */
  public static async listTickets(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)
    const parsed = listStaffTicketsQuerySchema.safeParse(req.query)

    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid query parameters',
      })
      return
    }

    const result = await SupportService.listStaffTickets(
      actor,
      parsed.data as ListStaffTicketsQuery
    )

    res.status(HTTP_STATUS.OK).json({ success: true, count: result.items.length, ...result })
  }

  /**
   * GET /api/v1/admin/support/tickets/:id
   */
  public static async getTicket(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)
    const ticket = await SupportService.getStaffTicket(actor, String(req.params.id))
    sendSuccess(res, { ticket }, 'Support ticket retrieved.')
  }

  /**
   * POST /api/v1/admin/support/tickets/:id/messages
   * Staff reply. Requires `support.reply`.
   */
  public static async reply(req: Request, res: Response): Promise<void> {
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

    const result = await SupportService.replyToTicket(actor, String(req.params.id), parsed.data)

    sendSuccess(res, result, 'Staff reply added.')
  }

  /**
   * PATCH /api/v1/admin/support/tickets/:id/status
   * Every transition here is written to the audit trail.
   */
  public static async updateStatus(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = staffStatusUpdateSchema.safeParse(req.body)
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

    const input: StaffStatusUpdateDTO = parsed.data
    const ticket = await SupportService.updateTicketStatus(actor, String(req.params.id), input)

    logger.info(
      { ticketId: ticket.id, status: ticket.status, actorId: actor.userId },
      'Support ticket status updated by staff'
    )

    sendSuccess(res, { ticket }, 'Support ticket updated.')
  }

  /**
   * PATCH /api/v1/admin/support/tickets/:id/assign
   */
  public static async assign(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = assignTicketSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Validation failed',
      })
      return
    }

    const input: AssignTicketDTO = parsed.data
    const ticket = await SupportService.assignTicket(actor, String(req.params.id), input)

    sendSuccess(res, { ticket }, 'Support ticket assignment updated.')
  }

  /**
   * GET /api/v1/admin/support/tickets/:id/notifications
   */
  public static async listNotifications(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)
    const result = await SupportService.listTicketNotifications(actor, String(req.params.id))
    sendSuccess(res, result, 'Notification delivery history retrieved.')
  }

  /**
   * GET /api/v1/admin/support/overview
   */
  public static async overview(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    // PERFORMANCE: was 5 sequential `listStaffTickets` calls reading only
    // `.pagination.total` and throwing away the rows — 15 round trips at depth 5.
    sendSuccess(res, await SupportService.getStaffOverview(actor))
  }
}

/**
 * Staff contact-submission inbox.
 */
export class StaffContactController {
  /**
   * GET /api/v1/admin/contact-submissions
   */
  public static async list(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = listContactSubmissionsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid query parameters',
      })
      return
    }

    const result = await ContactService.listSubmissions(
      actor,
      parsed.data as ListContactSubmissionsQuery
    )

    res.status(HTTP_STATUS.OK).json({ success: true, count: result.items.length, ...result })
  }

  /**
   * GET /api/v1/admin/contact-submissions/:id
   */
  public static async get(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)
    const submission = await ContactService.getSubmission(actor, String(req.params.id))
    sendSuccess(res, { submission }, 'Contact submission retrieved.')
  }

  /**
   * PATCH /api/v1/admin/contact-submissions/:id
   */
  public static async triage(req: Request, res: Response): Promise<void> {
    const actor = requireActorContext(req)

    const parsed = triageContactSchema.safeParse(req.body)
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

    const input: TriageContactDTO = parsed.data
    const result = await ContactService.triageSubmission(actor, String(req.params.id), input)

    sendSuccess(res, result, 'Contact submission triaged.')
  }
}