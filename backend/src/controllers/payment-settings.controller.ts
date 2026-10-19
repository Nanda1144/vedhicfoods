import { Request, Response } from 'express'
import { z } from 'zod'
import { logger } from '../config/logger'
import { PaymentSettingsService } from '../services/payment-settings.service'
import { sendControllerError } from '../utils/api-response'

const updatePaymentSettingsSchema = z
  .object({
    razorpayKeyId: z.string().trim().max(120).optional(),
    razorpayKeySecret: z.string().trim().max(500).optional(),
    razorpayKeySecretMasked: z.string().max(500).optional(),
    webhookSecret: z.string().trim().max(500).optional(),
    webhookSecretMasked: z.string().max(500).optional(),
    enabledMethods: z
      .array(z.enum(['razorpay', 'upi', 'card', 'netbanking']))
      .max(10)
      .optional(),
    onlineEnabled: z.boolean().optional(),
    testMode: z.boolean().optional(),
    codEnabled: z.boolean().optional(),
    codLimit: z.coerce.number().min(0).max(10_000_000).optional(),
  })
  .strict()

/**
 * Admin-managed Razorpay configuration.
 *
 * Secrets are encrypted with the dedicated payment key (AES-256-GCM + per-field
 * AAD) and are never returned in plaintext. Masked values posted back by an
 * untouched form are ignored, so saving other toggles cannot corrupt or wipe
 * stored credentials.
 */
export class PaymentSettingsController {
  public static async getSettings(_req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await PaymentSettingsService.getAdminSettings())
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch payment settings')
      sendControllerError(res, error, 'Failed to retrieve payment settings')
    }
  }

  public static async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      const actorId = req.user?.id
      if (!actorId) {
        res.status(401).json({ error: 'Authentication required.' })
        return
      }

      const parsed = updatePaymentSettingsSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.issues.map((issue) => issue.message),
        })
        return
      }

      res.status(200).json(await PaymentSettingsService.updateSettings(parsed.data, actorId))
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update payment settings')
      sendControllerError(res, error, 'Failed to update payment settings')
    }
  }

  /**
   * Read-only credential probe. Lists one existing Razorpay order, which proves
   * authentication without creating an order or moving money.
   */
  public static async testConnection(_req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await PaymentSettingsService.testConnection())
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Payment gateway connection test failed')
      sendControllerError(res, error, 'Payment gateway connection test failed')
    }
  }
}
