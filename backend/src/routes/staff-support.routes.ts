import { Router } from 'express'
import {
  StaffContactController,
  StaffSupportController,
} from '../controllers/staff-support.controller'
import { authenticate, requirePermission } from '../middleware/auth.middleware'
import { ticketReplyRateLimiter } from '../middleware/rate-limiter.middleware'
import { asyncHandler } from '../utils/async-handler'

const router = Router()

// Every support-console endpoint requires an authenticated staff account.
router.use(authenticate)

// Aggregates must be declared before the `/:id` parameterised routes so they are
// not swallowed by them.
router.get('/overview', requirePermission('support.read'), asyncHandler(StaffSupportController.overview))

// ==========================================
// TICKET INBOX
// ==========================================
router.get('/tickets', requirePermission('support.read'), asyncHandler(StaffSupportController.listTickets))
router.get('/tickets/:id', requirePermission('support.read'), asyncHandler(StaffSupportController.getTicket))
router.post(
  '/tickets/:id/messages',
  requirePermission('support.reply'),
  ticketReplyRateLimiter,
  asyncHandler(StaffSupportController.reply)
)
router.patch(
  '/tickets/:id/status',
  requirePermission('support.update'),
  asyncHandler(StaffSupportController.updateStatus)
)
router.patch(
  '/tickets/:id/assign',
  requirePermission('support.assign'),
  asyncHandler(StaffSupportController.assign)
)
router.get(
  '/tickets/:id/notifications',
  requirePermission('support.read'),
  asyncHandler(StaffSupportController.listNotifications)
)

// ==========================================
// CONTACT SUBMISSION INBOX
// ==========================================
router.get(
  '/contact-submissions',
  requirePermission('contacts.read'),
  asyncHandler(StaffContactController.list)
)
router.get(
  '/contact-submissions/:id',
  requirePermission('contacts.read'),
  asyncHandler(StaffContactController.get)
)
router.patch(
  '/contact-submissions/:id',
  requirePermission('contacts.manage'),
  asyncHandler(StaffContactController.triage)
)

export const staffSupportRoutes = router