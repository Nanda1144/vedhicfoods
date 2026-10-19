import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

/**
 * Version prefix for credentials encrypted with the dedicated payment key.
 *
 * Format: `v2:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 *
 * The prefix is part of the on-disk contract. Legacy rows were written by
 * `encrypt32` as `iv:tag:ciphertext` and remain readable, but every new write
 * uses v2 so a future key rotation can identify what still needs re-encryption.
 */
const PAYMENT_CIPHERTEXT_VERSION = 'v2'
const PAYMENT_KEY_ENV = 'PAYMENT_CREDENTIALS_ENCRYPTION_KEY'
const PAYMENT_AAD_PREFIX = 'vedhicfoods:payment-settings:default:'

/**
 * Historical default, previously duplicated here and in the backend env schema.
 *
 * SECURITY: this value is published in `.env.example` and in the source of both
 * packages. It is retained ONLY so that a developer laptop or CI run without an
 * explicit ENCRYPTION_KEY still round-trips existing local data. Production
 * (and staging) refuse to use it — see `resolveKeyMaterial` below, and the
 * equivalent guard in backend/src/config/env.ts which aborts boot.
 */
const DEFAULT_ENCRYPTION_KEY = 'vedhicfoods_secure_32bit_key_2026_aes!'

/** Keys that must never be used to protect payment credentials outside dev/test. */
const INSECURE_PLACEHOLDER_KEYS: readonly string[] = [DEFAULT_ENCRYPTION_KEY]

/**
 * Resolves the key-derivation input, refusing to fall back to the published
 * default outside development/test.
 *
 * @throws when ENCRYPTION_KEY is absent, too short, or still the placeholder.
 */
function resolveKeyMaterial(): string {
  const nodeEnv = process.env.NODE_ENV || 'development'
  const isProductionLike = nodeEnv === 'production' || nodeEnv === 'staging'

  const configured = process.env.ENCRYPTION_KEY

  if (configured && configured.trim().length > 0) {
    if (isProductionLike && INSECURE_PLACEHOLDER_KEYS.includes(configured.trim())) {
      throw new Error(
        'ENCRYPTION_KEY is still the placeholder value committed to the repository. ' +
          'Set a unique 32+ character key via AWS Secrets Manager / SSM Parameter Store. ' +
          'Rotating it will require re-encrypting stored payment credentials.'
      )
    }
    return configured
  }

  if (isProductionLike) {
    throw new Error(
      'ENCRYPTION_KEY is required in production/staging. It protects AES-256-GCM ' +
        'encryption of stored payment gateway credentials.'
    )
  }

  return DEFAULT_ENCRYPTION_KEY
}

/**
 * Derives a deterministic 32-byte (256-bit) encryption key from the environment key.
 */
function getDerivedKey(): Buffer {
  return crypto.createHash('sha256').update(resolveKeyMaterial()).digest()
}

/**
 * Encrypts a sensitive string using 32-byte AES-256-GCM.
 * Output format: <iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encrypt32(plainText: string): string {
  if (!plainText) return ''

  const key = getDerivedKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plainText, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 */
export function decrypt32(encryptedPayload: string): string {
  if (!encryptedPayload) return ''

  const parts = encryptedPayload.split(':')
  if (parts.length !== 3) {
    // Return empty if not in encrypted format
    return encryptedPayload
  }

  const [ivHex, authTagHex, encryptedHex] = parts
  const key = getDerivedKey()
  const iv = Buffer.from(ivHex!, 'hex')
  const authTag = Buffer.from(authTagHex!, 'hex')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedHex!, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

function isProductionLike(): boolean {
  const nodeEnv = process.env.NODE_ENV || 'development'
  return nodeEnv === 'production' || nodeEnv === 'staging'
}

function isInsecurePlaceholder(value: string): boolean {
  const lowered = value.trim().toLowerCase()
  return (
    INSECURE_PLACEHOLDER_KEYS.includes(value.trim()) ||
    lowered.includes('replace_me') ||
    lowered.includes('placeholder') ||
    lowered.includes('changeme') ||
    lowered.includes('change_me')
  )
}

/**
 * Dedicated key material for admin-managed payment credentials.
 *
 * Production and staging require `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` and never
 * fall back to the general-purpose `ENCRYPTION_KEY`. Development/test may fall
 * back so an existing local checkout keeps working, but credentials are still
 * written in the v2 format and can be migrated simply by setting the dedicated
 * key before rotating them from the admin console.
 */
function resolvePaymentKeyMaterial(): string {
  const dedicated = (process.env[PAYMENT_KEY_ENV] || '').trim()

  if (dedicated.length > 0) {
    if (isInsecurePlaceholder(dedicated)) {
      throw new Error(
        `${PAYMENT_KEY_ENV} still holds a placeholder/template value. ` +
          'Generate a unique 32+ character secret before saving payment credentials.'
      )
    }
    if (dedicated.length < 32) {
      throw new Error(`${PAYMENT_KEY_ENV} must be at least 32 characters long.`)
    }
    return dedicated
  }

  if (isProductionLike()) {
    throw new Error(
      `${PAYMENT_KEY_ENV} is required in production/staging before payment credentials ` +
        'can be saved. Existing credentials encrypted with the legacy ENCRYPTION_KEY ' +
        'remain readable and are re-encrypted on the next save.'
    )
  }

  return resolveKeyMaterial()
}

export function isPaymentEncryptionKeyAvailable(): boolean {
  const dedicated = (process.env[PAYMENT_KEY_ENV] || '').trim()
  if (dedicated.length >= 32 && !isInsecurePlaceholder(dedicated)) return true
  return !isProductionLike()
}

export type PaymentSecretField = 'razorpayKeySecret' | 'webhookSecret'

function paymentAad(field: PaymentSecretField): Buffer {
  return Buffer.from(`${PAYMENT_AAD_PREFIX}${field}`, 'utf8')
}

/**
 * Encrypts an admin-managed payment credential using AES-256-GCM with the
 * dedicated payment key and field-specific additional authenticated data.
 *
 * Binding the ciphertext to its field means a `razorpayKeySecret` value cannot
 * be moved into the `webhookSecret` column (or vice versa) and still decrypt,
 * which prevents credential-confusion mistakes during support/ops work.
 */
export function encryptPaymentSecret(plainText: string, field: PaymentSecretField): string {
  if (!plainText) return ''

  const key = crypto.createHash('sha256').update(resolvePaymentKeyMaterial()).digest()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(paymentAad(field))

  let encrypted = cipher.update(plainText, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')

  return `${PAYMENT_CIPHERTEXT_VERSION}:${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypts a v2 payment credential. Legacy three-part payloads written by
 * `encrypt32` are still accepted and are re-encrypted as v2 on the next save.
 */
export function decryptPaymentSecret(encryptedPayload: string, field: PaymentSecretField): string {
  if (!encryptedPayload) return ''

  const parts = encryptedPayload.split(':')
  if (parts[0] !== PAYMENT_CIPHERTEXT_VERSION) {
    return decrypt32(encryptedPayload)
  }
  if (parts.length !== 4) {
    throw new Error('Stored payment credential is not in a recognised encrypted format.')
  }

  const [, ivHex, authTagHex, encryptedHex] = parts
  const key = crypto.createHash('sha256').update(resolvePaymentKeyMaterial()).digest()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex!, 'hex'))
  decipher.setAAD(paymentAad(field))
  decipher.setAuthTag(Buffer.from(authTagHex!, 'hex'))

  let decrypted = decipher.update(encryptedHex!, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Masks a secret string for safe display in the Admin UI.
 * e.g. "rzp_sec_1234567890abcdef" -> "rzp_sec_••••••••••••cdef"
 */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '••••••••'
  const prefix = secret.slice(0, 4)
  const suffix = secret.slice(-4)
  return `${prefix}••••••••••••${suffix}`
}