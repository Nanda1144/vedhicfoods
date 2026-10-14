import { Request, Response } from 'express'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { EmailSuppressionService } from '../integrations/email/email-suppression.service'
import { isAllowedSnsUrl, verifySnsMessage, type SnsEnvelope } from '../integrations/email/sns-verifier'

/**
 * Inbound SES → SNS bounce/complaint webhook.
 *
 * SNS calls this endpoint directly, so it is unauthenticated and relies on
 * signature verification (see `sns-verifier.ts`) plus an optional TopicArn
 * allowlist to establish trust before it mutates the suppression list.
 */
export class EmailWebhookController {
  public static async handleSns(req: Request, res: Response): Promise<void> {
    const message = (req.body ?? {}) as SnsEnvelope

    if (typeof message.Type !== 'string') {
      res.status(400).json({ error: 'Invalid SNS envelope' })
      return
    }

    if (env.SNS_EMAIL_TOPIC_ARN && message.TopicArn && message.TopicArn !== env.SNS_EMAIL_TOPIC_ARN) {
      logger.warn({ topicArn: message.TopicArn }, 'Rejected SNS message from an unexpected topic')
      res.status(403).json({ error: 'Unexpected SNS topic' })
      return
    }

    if (env.SNS_VERIFY_SIGNATURE) {
      try {
        await verifySnsMessage(message)
      } catch (error: any) {
        logger.warn({ error: error?.message }, 'Rejected SNS message: signature verification failed')
        res.status(403).json({ error: 'SNS signature verification failed' })
        return
      }
    }

    try {
      // SNS requires the subscription to be confirmed by fetching the
      // SubscribeURL. The URL is host-validated to avoid an SSRF sink.
      if (message.Type === 'SubscriptionConfirmation') {
        if (message.SubscribeURL && isAllowedSnsUrl(message.SubscribeURL)) {
          await fetch(message.SubscribeURL)
        }
        res.status(200).json({ success: true, message: 'Subscription confirmation handled' })
        return
      }

      if (message.Type === 'Notification') {
        let event: any = {}
        try {
          event = JSON.parse(message.Message || '{}')
        } catch {
          event = {}
        }
        const suppressed = await EmailSuppressionService.applySesEvent(event)
        res.status(200).json({ success: true, data: { suppressed } })
        return
      }

      res.status(200).json({ success: true, message: `Ignored SNS message type ${message.Type}` })
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Failed to process SNS email event')
      res.status(500).json({ error: 'Failed to process SNS message' })
    }
  }
}
