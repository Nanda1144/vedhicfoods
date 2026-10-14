import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16

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