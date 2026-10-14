import './_safety'
import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { encrypt32, decrypt32, maskSecret } from 'vedhicfoods-database'
import { AuthService } from '../../src/services/auth.service'

const app = createApp()

describe('Payment Gateway & Encryption Integration Tests', () => {
  let adminToken: string

  beforeAll(async () => {
    const adminLogin = await AuthService.login({
      email: 'admin@vedhicfoods.com',
      password: 'Admin@Vedhic2026',
    })
    adminToken = adminLogin.accessToken
  })

  it('encrypt32 and decrypt32 should properly encrypt and decrypt with 32-byte AES', () => {
    const secret = 'rzp_live_secret_key_1234567890'
    const encrypted = encrypt32(secret)

    expect(encrypted).not.toBe(secret)
    expect(encrypted.split(':')).toHaveLength(3) // iv:authTag:ciphertext

    const decrypted = decrypt32(encrypted)
    expect(decrypted).toBe(secret)
  })

  it('maskSecret should properly mask credentials for UI safety', () => {
    const secret = 'rzp_live_secret_key_1234567890'
    const masked = maskSecret(secret)

    expect(masked).toContain('••••••••••••')
    expect(masked.startsWith('rzp_')).toBe(true)
    expect(masked.endsWith('7890')).toBe(true)
  })

  it('GET /api/v1/admin/payment-settings should return masked credentials for authenticated admin', async () => {
    const res = await request(app)
      .get('/api/v1/admin/payment-settings')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.provider).toBe('razorpay')
    expect(res.body.razorpayKeyId).toBeDefined()
    expect(res.body.razorpayKeySecretMasked).toBeDefined()
    expect(res.body.enabledMethods).toBeInstanceOf(Array)
  }, 15000)

  it('PUT /api/v1/admin/payment-settings should update and encrypt new secrets', async () => {
    const payload = {
      razorpayKeyId: 'rzp_test_new_key_id',
      razorpayKeySecret: 'new_secret_key_test_value',
      webhookSecret: 'new_webhook_secret_value',
      enabledMethods: ['razorpay', 'upi', 'card'],
      testMode: true,
      codEnabled: true,
      codLimit: 7500,
    }

    const res = await request(app)
      .put('/api/v1/admin/payment-settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.razorpayKeyId).toBe('rzp_test_new_key_id')
    expect(res.body.codLimit).toBe(7500)
    // Secret returned must be masked, not raw plaintext!
    expect(res.body.razorpayKeySecretMasked).toContain('••••')
    expect(res.body.razorpayKeySecretMasked).not.toBe('new_secret_key_test_value')
  }, 30000)
})
