import { Router } from 'express'
import { EmailWebhookController } from '../controllers/email-webhook.controller'

const router = Router()

/**
 * POST /api/v1/webhooks/email/sns
 *
 * Receives SES bounce/complaint events via SNS. No auth middleware — SNS
 * authenticates through the message signature, verified inside the handler.
 * The body is parsed by the global `express.json()`; the canonical string SNS
 * signs is derived from the parsed fields, so no raw-body capture is required.
 */
router.post('/email/sns', EmailWebhookController.handleSns)

export const emailWebhookRoutes = router
