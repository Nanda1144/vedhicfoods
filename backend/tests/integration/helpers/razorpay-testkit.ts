/**
 * Razorpay test-kit.
 *
 * Centralises two things that every payment suite must do identically:
 *
 * 1. **Credential detection.** The live-gateway suites may only run against a
 *    real Razorpay *sandbox* key pair. Shipping placeholder credentials is the
 *    normal state of this repository, and a naive suite would then either hit
 *    the real gateway with garbage auth (slow, flaky 401s) or — worse — be
 *    "fixed" by stubbing a captured payment and calling it success. Instead the
 *    live suites are gated on `LIVE_RAZORPAY`; when it is false they are
 *    reported as skipped/BLOCKED rather than simulated.
 *
 * 2. **Signature helpers.** HMAC-SHA256 signatures are computed here with the
 *    *same* configured secrets the server uses, so signature-handling suites
 *    exercise the real verification code path (no fake acceptance).
 */

import crypto from 'crypto'
import { env } from '../../../src/config/env'

const PLACEHOLDER_MARKER = 'placeholder'

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true
  return value.toLowerCase().includes(PLACEHOLDER_MARKER)
}

export interface RazorpayCredentialReport {
  /** Configured public key id (never a secret — safe to log). */
  keyId: string
  keyIdIsTestKey: boolean
  keyIdIsPlaceholder: boolean
  secretPresent: boolean
  secretIsPlaceholder: boolean
  webhookSecretPresent: boolean
  webhookSecretIsPlaceholder: boolean
  /** True only for a real `rzp_test_*` key id AND a non-placeholder secret. */
  liveGatewayReady: boolean
  /** True when a non-placeholder webhook secret is configured. */
  webhookUsable: boolean
  reason: string
}

/**
 * Classifies the configured Razorpay credentials without ever reading or
 * echoing the secret values themselves.
 */
export function razorpayCredentialReport(): RazorpayCredentialReport {
  const keyId = env.RAZORPAY_KEY_ID || ''
  const secret = env.RAZORPAY_KEY_SECRET || ''
  const webhook = env.RAZORPAY_WEBHOOK_SECRET || ''

  const keyIdIsPlaceholder = isPlaceholder(keyId)
  const keyIdIsTestKey = /^rzp_test_[A-Za-z0-9]+$/.test(keyId) && !keyIdIsPlaceholder
  const secretPresent = secret.trim().length > 0
  const secretIsPlaceholder = isPlaceholder(secret)
  const webhookSecretPresent = webhook.trim().length > 0
  const webhookSecretIsPlaceholder = isPlaceholder(webhook)

  const liveGatewayReady = keyIdIsTestKey && secretPresent && !secretIsPlaceholder

  let reason: string
  if (liveGatewayReady) {
    reason = 'Live Razorpay sandbox credentials are configured (rzp_test_*).'
  } else if (!keyIdIsTestKey) {
    reason =
      'BLOCKED: RAZORPAY_KEY_ID is not a real sandbox key (expected rzp_test_...). ' +
      'Live gateway tests are skipped.'
  } else {
    reason =
      'BLOCKED: RAZORPAY_KEY_SECRET is missing or still a placeholder. ' +
      'Live gateway tests are skipped.'
  }

  return {
    keyId,
    keyIdIsTestKey,
    keyIdIsPlaceholder,
    secretPresent,
    secretIsPlaceholder,
    webhookSecretPresent,
    webhookSecretIsPlaceholder,
    liveGatewayReady,
    webhookUsable: webhookSecretPresent && !webhookSecretIsPlaceholder,
    reason,
  }
}

export const RAZORPAY_CREDENTIALS = razorpayCredentialReport()

/** Gate for suites that make real calls to api.razorpay.com. */
export const LIVE_RAZORPAY = RAZORPAY_CREDENTIALS.liveGatewayReady

/**
 * Checkout signature: HMAC_SHA256("<razorpayOrderId>|<razorpayPaymentId>",
 * key_secret). Mirrors `RazorpayService.verifyPaymentSignature`.
 */
export function paymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  secret: string = env.RAZORPAY_KEY_SECRET
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex')
}

/**
 * Webhook signature: HMAC_SHA256(rawBodyBytes, webhook_secret). Mirrors
 * `RazorpayService.verifyWebhookSignature` — accepts a Buffer so callers can
 * sign the *exact* bytes they transmit.
 */
export function webhookSignature(
  rawBody: Buffer | string,
  secret: string = env.RAZORPAY_WEBHOOK_SECRET
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
    .digest('hex')
}

export function webhookSecret(): string {
  return env.RAZORPAY_WEBHOOK_SECRET
}
