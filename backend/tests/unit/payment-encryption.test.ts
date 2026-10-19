import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  decryptPaymentSecret,
  encryptPaymentSecret,
  encrypt32,
  decrypt32,
  isPaymentEncryptionKeyAvailable,
} from 'vedhicfoods-database'

const PAYMENT_KEY = 'unit_test_payment_credentials_encryption_key_32b!'
const LEGACY_KEY = 'unit_test_legacy_encryption_key_change_me_32bytes!'

describe('admin-managed payment credential encryption', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalPaymentKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY
  const originalEncryptionKey = process.env.ENCRYPTION_KEY

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = PAYMENT_KEY
    process.env.ENCRYPTION_KEY = LEGACY_KEY
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalPaymentKey === undefined) delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY
    else process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = originalPaymentKey
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = originalEncryptionKey
  })

  it('round-trips a secret and tags the ciphertext as v2', () => {
    const encrypted = encryptPaymentSecret('rzp_secret_value', 'razorpayKeySecret')

    expect(encrypted.split(':')).toHaveLength(4)
    expect(encrypted.startsWith('v2:')).toBe(true)
    expect(encrypted).not.toContain('rzp_secret_value')
    expect(decryptPaymentSecret(encrypted, 'razorpayKeySecret')).toBe('rzp_secret_value')
  })

  it('binds the ciphertext to its field via AAD', () => {
    const encrypted = encryptPaymentSecret('shared_value', 'razorpayKeySecret')

    expect(decryptPaymentSecret(encrypted, 'razorpayKeySecret')).toBe('shared_value')
    expect(() => decryptPaymentSecret(encrypted, 'webhookSecret')).toThrow()
  })

  it('still decrypts legacy three-part payloads written by encrypt32', () => {
    const legacy = encrypt32('legacy_secret_value')

    expect(legacy.split(':')).toHaveLength(3)
    expect(decryptPaymentSecret(legacy, 'razorpayKeySecret')).toBe('legacy_secret_value')
    expect(decrypt32(legacy)).toBe('legacy_secret_value')
  })

  it('reports the dedicated key as available in test', () => {
    expect(isPaymentEncryptionKeyAvailable()).toBe(true)
  })

  it('refuses a placeholder dedicated key', () => {
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'REPLACE_ME_PAYMENT_KEY_min_32_chars_value'

    expect(() => encryptPaymentSecret('value', 'razorpayKeySecret')).toThrow(/placeholder/i)
  })

  it('requires a dedicated key in production and does not fall back to ENCRYPTION_KEY', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY

    expect(isPaymentEncryptionKeyAvailable()).toBe(false)
    expect(() => encryptPaymentSecret('value', 'razorpayKeySecret')).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY is required/
    )
  })

  it('does not fall back to ENCRYPTION_KEY in staging either', () => {
    process.env.NODE_ENV = 'staging'
    delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY

    expect(() => encryptPaymentSecret('value', 'webhookSecret')).toThrow(
      /PAYMENT_CREDENTIALS_ENCRYPTION_KEY is required/
    )
  })
})
