import { Request, Response } from 'express'
import { prisma } from '../config/database'
import { encrypt32, decrypt32, maskSecret } from 'vedhicfoods-database'
import { logger } from '../config/logger'
import { clearRazorpayCredentialCache } from '../integrations/razorpay/razorpay.client'

/**
 * Controller for managing Razorpay and payment gateway configurations.
 * All credentials are stored with 32-byte AES-256-GCM encryption in PostgreSQL.
 */
export class PaymentSettingsController {
  /**
   * GET /api/v1/admin/payment-settings
   * Returns current payment gateway settings with masked secrets.
   *
   * SECURITY: this used to auto-create a settings row on first read, seeding
   * `encrypt32('test_secret_key_32byte_aes')` and a matching webhook secret with
   * `testMode: true`. That is a genuine weakness, not just untidiness:
   *   - A read endpoint silently mutating state means the row appears
   *     "configured" to any operator or dashboard that checks for its existence.
   *   - The credentials were constants committed to the repository, encrypted
   *     with the same key as everything else, so anyone with the source could
   *     decrypt them.
   *   - Real webhooks would be verified against that known constant, so an
   *     attacker who knew the code could forge a signature that validated.
   *
   * A missing configuration is now reported honestly as unconfigured and must be
   * supplied through updateSettings (or the encrypted seed), never invented here.
   */
  public static async getSettings(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await prisma.paymentSettings.findUnique({
        where: { id: 'default' },
      })

      if (!settings) {
        res.status(200).json({
          id: null,
          provider: 'razorpay',
          configured: false,
          razorpayKeyId: null,
          razorpayKeySecretMasked: null,
          webhookSecretMasked: null,
          hasKeySecret: false,
          hasWebhookSecret: false,
          enabledMethods: [],
          testMode: true,
          codEnabled: true,
          codLimit: 5000,
          message:
            'Payment gateway is not configured. Submit the Razorpay key id, key secret ' +
            'and webhook secret to enable it.',
        })
        return
      }

      const decryptedKeySecret = settings.encryptedKeySecret
        ? decrypt32(settings.encryptedKeySecret)
        : ''
      const decryptedWebhookSecret = settings.encryptedWebhookSecret
        ? decrypt32(settings.encryptedWebhookSecret)
        : ''

      res.status(200).json({
        id: settings.id,
        provider: settings.provider,
        configured: Boolean(settings.encryptedKeySecret && settings.encryptedWebhookSecret),
        razorpayKeyId: settings.razorpayKeyId,
        razorpayKeySecretMasked: maskSecret(decryptedKeySecret),
        webhookSecretMasked: maskSecret(decryptedWebhookSecret),
        hasKeySecret: Boolean(settings.encryptedKeySecret),
        hasWebhookSecret: Boolean(settings.encryptedWebhookSecret),
        enabledMethods: settings.enabledMethods,
        testMode: settings.testMode,
        codEnabled: settings.codEnabled,
        codLimit: settings.codLimit,
        updatedAt: settings.updatedAt.toISOString(),
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch payment settings')
      res.status(500).json({ error: 'Failed to retrieve payment settings' })
    }
  }

  /**
   * PUT /api/v1/admin/payment-settings
   * Updates payment gateway settings and encrypts secrets with 32-byte AES encryption.
   */
  public static async updateSettings(req: Request, res: Response): Promise<void> {
    try {
      // SECURITY: `updatedBy` was the literal string 'Admin', so every change to
      // the live payment gateway was attributed to an actor that does not exist.
      // A change to the key secret or webhook secret must be attributable to a
      // real principal.
      const actorId = req.user?.id
      if (!actorId) {
        res.status(401).json({ error: 'Authentication required.' })
        return
      }

      const {
        razorpayKeyId,
        razorpayKeySecret,
        razorpayKeySecretMasked,
        webhookSecret,
        webhookSecretMasked,
        enabledMethods,
        testMode,
        codEnabled,
        codLimit,
      } = req.body

      const existing = await prisma.paymentSettings.findUnique({
        where: { id: 'default' },
      })

      // Secret rotation semantics.
      //
      // The admin form posts the *masked* value back verbatim when the field is
      // untouched, a new plaintext value when the operator rotated it, and an
      // empty string if the input was cleared. Treat only a non-empty,
      // non-masked value as a rotation; an empty field must NOT wipe live
      // credentials, because a stray keystroke would otherwise take the payment
      // gateway offline. Deliberate removal needs its own explicit endpoint.
      let encryptedKeySecret = existing?.encryptedKeySecret || ''
      const keySecretInput = razorpayKeySecret ?? razorpayKeySecretMasked
      if (
        typeof keySecretInput === 'string' &&
        keySecretInput.trim().length > 0 &&
        !keySecretInput.includes('•')
      ) {
        encryptedKeySecret = encrypt32(keySecretInput.trim())
      }

      let encryptedWebhookSecret = existing?.encryptedWebhookSecret || ''
      const webhookInput = webhookSecret ?? webhookSecretMasked
      if (
        typeof webhookInput === 'string' &&
        webhookInput.trim().length > 0 &&
        !webhookInput.includes('•')
      ) {
        encryptedWebhookSecret = encrypt32(webhookInput.trim())
      }

      const updated = await prisma.paymentSettings.upsert({
        where: { id: 'default' },
        update: {
          razorpayKeyId: razorpayKeyId !== undefined ? razorpayKeyId : existing?.razorpayKeyId,
          encryptedKeySecret,
          encryptedWebhookSecret,
          enabledMethods: Array.isArray(enabledMethods) ? enabledMethods : existing?.enabledMethods,
          testMode: typeof testMode === 'boolean' ? testMode : existing?.testMode ?? true,
          codEnabled: typeof codEnabled === 'boolean' ? codEnabled : existing?.codEnabled ?? true,
          codLimit: typeof codLimit === 'number' ? codLimit : existing?.codLimit ?? 5000,
          updatedBy: actorId,
        },
        create: {
          id: 'default',
          provider: 'razorpay',
          razorpayKeyId: razorpayKeyId || '',
          encryptedKeySecret,
          encryptedWebhookSecret,
          enabledMethods: Array.isArray(enabledMethods) ? enabledMethods : ['razorpay', 'upi', 'card', 'netbanking'],
          testMode: typeof testMode === 'boolean' ? testMode : true,
          codEnabled: typeof codEnabled === 'boolean' ? codEnabled : true,
          codLimit: typeof codLimit === 'number' ? codLimit : 5000,
          updatedBy: actorId,
        },
      })

      const decryptedKeySecret = updated.encryptedKeySecret
        ? decrypt32(updated.encryptedKeySecret)
        : ''
      const decryptedWebhookSecret = updated.encryptedWebhookSecret
        ? decrypt32(updated.encryptedWebhookSecret)
        : ''

      logger.info(
        { actorId, testMode: updated.testMode },
        'Payment gateway credentials successfully updated and encrypted with 32-byte AES'
      )

      // Credentials changed: drop the resolver cache so the very next gateway
      // call uses the new key id / secret / webhook secret immediately, rather
      // than up to the cache TTL later.
      clearRazorpayCredentialCache()
      // Audit payment settings update
      try {
        await (await import('../services/audit.service')).AuditService.record({
          action: 'PAYMENT_SETTINGS_UPDATED',
          entity: 'PaymentSettings',
          entityId: updated.id,
          actorId,
          metadata: {
            provider: updated.provider,
            testMode: updated.testMode,
            codEnabled: updated.codEnabled,
            codLimit: updated.codLimit,
            // Record WHICH credentials changed, never their values.
            keySecretRotated:
              encryptedKeySecret !== (existing?.encryptedKeySecret ?? ''),
            webhookSecretRotated:
              encryptedWebhookSecret !== (existing?.encryptedWebhookSecret ?? ''),
          },
          req,
        })
      } catch {}

      res.status(200).json({
        id: updated.id,
        provider: updated.provider,
        razorpayKeyId: updated.razorpayKeyId,
        razorpayKeySecretMasked: maskSecret(decryptedKeySecret),
        webhookSecretMasked: maskSecret(decryptedWebhookSecret),
        hasKeySecret: Boolean(updated.encryptedKeySecret),
        hasWebhookSecret: Boolean(updated.encryptedWebhookSecret),
        enabledMethods: updated.enabledMethods,
        testMode: updated.testMode,
        codEnabled: updated.codEnabled,
        codLimit: updated.codLimit,
        updatedAt: updated.updatedAt.toISOString(),
      })
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update payment settings')
      res.status(500).json({ error: 'Failed to update payment settings' })
    }
  }
}
