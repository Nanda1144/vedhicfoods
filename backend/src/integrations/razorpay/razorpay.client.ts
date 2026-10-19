import Razorpay from 'razorpay'
import { env, isPlaceholderRazorpayCredential } from '../../config/env'
import { prisma } from '../../config/database'
import { decryptPaymentSecret } from 'vedhicfoods-database'
import { logger } from '../../config/logger'

const DEFAULT_ENABLED_METHODS = ['razorpay', 'upi', 'card', 'netbanking']

/**
 * Environment-derived client. Retained as a stable module-level singleton for
 * local/CI fallback and because existing tests spy on this object. It is only
 * used when no admin-configured database credentials are available.
 */
export const razorpayClient = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
})

export interface RazorpaySession {
  client: Razorpay
  /** Public key id handed to the storefront. Safe to expose. */
  keyId: string
  /** Secret used for HMAC checkout-signature verification. NEVER exposed. */
  keySecret: string
  /** Secret used for HMAC webhook-signature verification. NEVER exposed. */
  webhookSecret: string
  /** Where the active credentials came from. */
  source: 'database' | 'environment'
  /** Admin-configured test/live flag, when settings exist. */
  testMode: boolean | null
  /** True when a usable key id + key secret came from the admin settings row. */
  dbConfigured: boolean
  /** True when both key id and key secret are usable. */
  configured: boolean
  /** Whether online payments are enabled by the operator. */
  onlineEnabled: boolean
  /** Whether a usable webhook secret is present. */
  webhookConfigured: boolean
  /** Methods the operator has left enabled. */
  enabledMethods: string[]
  /** Decryption/configuration failure, surfaced for the admin screen. */
  credentialError: string | null
}

/**
 * Admin-provided credentials live encrypted in `payment_settings` (written from
 * the admin dashboard). They are the source of truth once present; the process
 * environment is only a fallback for local development and legacy deployments.
 *
 * Cached briefly so a burst of payments does not re-read + decrypt the row for
 * every gateway call, while still picking up an operator's change within a
 * minute. `updateSettings` force-clears the cache so a rotation is immediate.
 */
const CACHE_TTL_MS = 60_000
let cached: { value: RazorpaySession; expiresAt: number } | null = null

export function clearRazorpayCredentialCache(): void {
  cached = null
}

function isUsable(value: string): boolean {
  const normalised = value.trim()
  if (!normalised) return false
  if (env.NODE_ENV === 'production' && isPlaceholderRazorpayCredential(normalised)) {
    return false
  }
  return true
}

function decryptDbSecret(
  encrypted: string,
  field: 'razorpayKeySecret' | 'webhookSecret'
): { value: string; error: string | null } {
  if (!encrypted) return { value: '', error: null }
  try {
    return { value: decryptPaymentSecret(encrypted, field).trim(), error: null }
  } catch (error: any) {
    return {
      value: '',
      error:
        error?.message ||
        'Stored payment credentials could not be decrypted. Check PAYMENT_CREDENTIALS_ENCRYPTION_KEY.',
    }
  }
}

/**
 * Resolves the effective Razorpay credentials and availability state.
 *
 * Field-level fallback is preserved: a key id supplied in the dashboard can be
 * combined with a key secret still held in the environment (and vice-versa), so
 * staged rotations keep working. In production, published placeholder values
 * count as absent rather than silently acting as credentials.
 */
export async function resolveRazorpayCredentials(force = false): Promise<RazorpaySession> {
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  let settings: Awaited<ReturnType<typeof prisma.paymentSettings.findUnique>> = null
  let dbKeyId = ''
  let dbKeySecret = ''
  let dbWebhookSecret = ''
  let credentialError: string | null = null

  try {
    settings = await prisma.paymentSettings.findUnique({ where: { id: 'default' } })
    if (settings) {
      dbKeyId = (settings.razorpayKeyId || '').trim()
      const keySecret = decryptDbSecret(settings.encryptedKeySecret, 'razorpayKeySecret')
      const webhookSecret = decryptDbSecret(settings.encryptedWebhookSecret, 'webhookSecret')
      dbKeySecret = keySecret.value
      dbWebhookSecret = webhookSecret.value
      credentialError = keySecret.error || webhookSecret.error
      if (credentialError) {
        logger.error(
          { error: credentialError },
          'Failed to decrypt Razorpay credentials from payment settings; falling back to environment'
        )
      }
    }
  } catch (error: any) {
    credentialError = error?.message || 'Failed to read payment settings'
    // A database/decrypt failure must not silently disable refunds or webhook
    // verification: fall back to the environment and make the failure visible.
    logger.error(
      { error: credentialError },
      'Failed to read Razorpay credentials from payment settings; falling back to environment'
    )
  }

  const envKeyId = isUsable(env.RAZORPAY_KEY_ID) ? env.RAZORPAY_KEY_ID.trim() : ''
  const envKeySecret = isUsable(env.RAZORPAY_KEY_SECRET) ? env.RAZORPAY_KEY_SECRET.trim() : ''
  const envWebhookSecret = isUsable(env.RAZORPAY_WEBHOOK_SECRET)
    ? env.RAZORPAY_WEBHOOK_SECRET.trim()
    : ''

  const usableDbKeyId = isUsable(dbKeyId) ? dbKeyId : ''
  const usableDbKeySecret = isUsable(dbKeySecret) ? dbKeySecret : ''
  const usableDbWebhookSecret = isUsable(dbWebhookSecret) ? dbWebhookSecret : ''

  const keyId = usableDbKeyId || envKeyId
  const keySecret = usableDbKeySecret || envKeySecret
  const webhookSecret = usableDbWebhookSecret || envWebhookSecret
  const configured = Boolean(keyId && keySecret)
  const dbConfigured = Boolean(usableDbKeyId && usableDbKeySecret)

  const enabledMethods = Array.isArray(settings?.enabledMethods)
    ? settings!.enabledMethods
    : DEFAULT_ENABLED_METHODS

  const value: RazorpaySession = {
    // When the admin has configured credentials, a dedicated client is built from
    // them; otherwise the process-wide environment client is reused.
    client: dbConfigured
      ? new Razorpay({ key_id: keyId, key_secret: keySecret })
      : razorpayClient,
    keyId,
    keySecret,
    webhookSecret,
    source: dbConfigured ? 'database' : 'environment',
    testMode: settings?.testMode ?? null,
    dbConfigured,
    configured,
    onlineEnabled: settings ? settings.onlineEnabled : configured,
    webhookConfigured: Boolean(webhookSecret),
    enabledMethods,
    credentialError,
  }

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS }
  return value
}
