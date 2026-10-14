import Razorpay from 'razorpay'
import { env } from '../../config/env'
import { prisma } from '../../config/database'
import { decrypt32 } from 'vedhicfoods-database'
import { logger } from '../../config/logger'

/**
 * Environment-derived client. Retained as a stable module-level singleton for two
 * reasons: it is the fallback whenever the admin has not stored gateway
 * credentials, and it is the object existing tests spy on.
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
}

/**
 * Admin-provided credentials live encrypted in `payment_settings` (written from
 * the admin dashboard). They are the source of truth once present; the process
 * environment is only a fallback for local development and CI.
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

/**
 * Resolves the effective Razorpay credentials, preferring the admin-configured
 * database row over the environment. Field-level fallback: a key id supplied in
 * the dashboard can be combined with a key secret still held in the environment
 * (and vice-versa), which keeps staged rotations working.
 */
export async function resolveRazorpayCredentials(force = false): Promise<RazorpaySession> {
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  let dbKeyId = ''
  let dbKeySecret = ''
  let dbWebhookSecret = ''
  let testMode: boolean | null = null

  try {
    const settings = await prisma.paymentSettings.findUnique({ where: { id: 'default' } })
    if (settings) {
      dbKeyId = (settings.razorpayKeyId || '').trim()
      dbKeySecret = settings.encryptedKeySecret
        ? decrypt32(settings.encryptedKeySecret).trim()
        : ''
      dbWebhookSecret = settings.encryptedWebhookSecret
        ? decrypt32(settings.encryptedWebhookSecret).trim()
        : ''
      testMode = settings.testMode
    }
  } catch (error: any) {
    // A decrypt failure (e.g. ENCRYPTION_KEY rotated) must not silently disable
    // payments: fall back to the environment and make the failure visible.
    logger.error(
      { error: error?.message },
      'Failed to read Razorpay credentials from payment settings; falling back to environment'
    )
  }

  const dbConfigured = Boolean(dbKeyId && dbKeySecret)

  const keyId = dbKeyId || env.RAZORPAY_KEY_ID
  const keySecret = dbKeySecret || env.RAZORPAY_KEY_SECRET
  const webhookSecret = dbWebhookSecret || env.RAZORPAY_WEBHOOK_SECRET

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
    testMode,
    dbConfigured,
  }

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS }
  return value
}
