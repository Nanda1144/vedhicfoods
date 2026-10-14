import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { NotificationController } from '../controllers/notification.controller'
import { asyncHandler } from '../utils/async-handler'

const router = Router()

// The whole inbox is owner-scoped: `authenticate` supplies the user whose
// notifications (and only theirs) every handler below will read or mutate.
router.use(authenticate)

// GET /unread-count must be declared before GET /:id so the literal segment
// "unread-count" is never swallowed by the id parameter.
router.get('/unread-count', asyncHandler(NotificationController.unreadCount))
router.get('/', asyncHandler(NotificationController.list))
router.post('/read-all', asyncHandler(NotificationController.markAllRead))
router.get('/:id', asyncHandler(NotificationController.get))
router.post('/:id/read', asyncHandler(NotificationController.markRead))
router.post('/:id/unread', asyncHandler(NotificationController.markUnread))
router.delete('/:id', asyncHandler(NotificationController.remove))

export const notificationRoutes = router