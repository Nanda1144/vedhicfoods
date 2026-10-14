import { Request, Response } from 'express'
import { NotificationType } from '@prisma/client'
import { prisma } from '../config/database'
import { sendSuccess } from '../utils/api-response'
import { NotFoundError, UnauthorizedError } from '../utils/errors'
import { clampPageNumber, clampPageSize } from '../utils/pagination'
import { HTTP_STATUS } from '../constants'

/**
 * Customer / staff notification centre.
 *
 * Every endpoint is scoped to the authenticated user's own inbox — there is no
 * role or permission gate because the isolation is by construction: the id in
 * the URL is resolved against `userId = req.user.id`, and any other user's
 * notification is indistinguishable from one that does not exist (404). This is
 * the same anti-enumeration posture the support ticket endpoints use.
 */
export class NotificationController {
  public static async list(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const userId = req.user.id
    const page = clampPageNumber(req.query.page, 1)
    const perPage = clampPageSize(req.query.per_page, 20, 100)

    const requestedType = req.query.type
    const type =
      typeof requestedType === 'string' && (Object.values(NotificationType) as string[]).includes(requestedType)
        ? (requestedType as NotificationType)
        : undefined

    const unreadOnly =
      req.query.unreadOnly === 'true' ||
      req.query.unreadOnly === '1' ||
      req.query.unread === 'true' ||
      req.query.unread === '1'

    const where: { userId: string; type?: NotificationType; isRead?: boolean } = {
      userId,
      ...(type ? { type } : {}),
      ...(unreadOnly ? { isRead: false } : {}),
    }

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ])

    sendSuccess(res, {
      items,
      pagination: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
      unreadCount,
    })
  }

  public static async unreadCount(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const unreadCount = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    })
    sendSuccess(res, { unreadCount })
  }

  public static async get(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const row = await prisma.notification.findFirst({
      where: { id: String(req.params.id), userId: req.user.id },
    })
    if (!row) throw new NotFoundError('Notification not found.')
    sendSuccess(res, { notification: row })
  }

  public static async markRead(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const result = await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: req.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    if (result.count === 0) {
      // Either it does not exist, is not theirs, or is already read. Reporting
      // a 404 for an already-read notification lets a client retry idempotently
      // without inventing a distinction an attacker could probe.
      const exists = await prisma.notification.findFirst({
        where: { id: String(req.params.id), userId: req.user.id },
        select: { id: true },
      })
      if (!exists) throw new NotFoundError('Notification not found.')
    }
    sendSuccess(res, { id: String(req.params.id), isRead: true })
  }

  public static async markUnread(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const result = await prisma.notification.updateMany({
      where: { id: String(req.params.id), userId: req.user.id },
      data: { isRead: false, readAt: null },
    })
    if (result.count === 0) throw new NotFoundError('Notification not found.')
    sendSuccess(res, { id: String(req.params.id), isRead: false })
  }

  public static async markAllRead(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const result = await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    sendSuccess(res, { updated: result.count })
  }

  public static async remove(req: Request, res: Response): Promise<void> {
    if (!req.user) throw new UnauthorizedError()
    const result = await prisma.notification.deleteMany({
      where: { id: String(req.params.id), userId: req.user.id },
    })
    if (result.count === 0) throw new NotFoundError('Notification not found.')
    sendSuccess(res, { id: String(req.params.id), deleted: true }, 'Notification deleted', HTTP_STATUS.OK)
  }
}