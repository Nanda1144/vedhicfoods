import { Router } from 'express'
import { ContactController, SupportController } from '../controllers/support.controller'
import { authenticate, optionalAuth } from '../middleware/auth.middleware'
import {
  contactRateLimiter,
  ticketCreateRateLimiter,
  ticketReplyRateLimiter,
} from '../middleware/rate-limiter.middleware'
import { asyncHandler } from '../utils/async-handler'

const router = Router()

// ==========================================
// PUBLIC CONTACT FORM
// ==========================================
// Mounted at `/api/v1/contact`. Unauthenticated by design: `optionalAuth` never
// rejects, it only attaches req.user when a valid token happens to be present so
// the submission can be attributed to a registered account.
router.post(
  '/',
  contactRateLimiter,
  optionalAuth,
  asyncHandler(ContactController.submit)
)

export const contactRoutes = router

// ==========================================
// CUSTOMER SUPPORT TICKETS
// ==========================================
// Mounted at `/api/v1/support`, deliberately separate from the contact router
// above: sharing one router across both mounts exposed the contact handler at
// `POST /api/v1/support` and the ticket handlers at `POST /api/v1/contact/tickets`.
const ticketRouter = Router()

ticketRouter.use(authenticate)

ticketRouter.post('/tickets', ticketCreateRateLimiter, asyncHandler(SupportController.createTicket))
ticketRouter.get('/tickets', asyncHandler(SupportController.listMyTickets))
ticketRouter.get('/tickets/:id', asyncHandler(SupportController.getMyTicket))
ticketRouter.post(
  '/tickets/:id/messages',
  ticketReplyRateLimiter,
  asyncHandler(SupportController.replyToTicket)
)
ticketRouter.post('/tickets/:id/close', asyncHandler(SupportController.closeTicket))
ticketRouter.post('/tickets/:id/reopen', asyncHandler(SupportController.reopenTicket))

export const ticketRoutes = ticketRouter