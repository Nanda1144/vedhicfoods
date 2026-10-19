/**
 * Admin-managed Payment Settings suite.
 *
 * Covers the operator flow end-to-end without touching Razorpay: saving
 * credentials, the fail-closed storefront read model, server-side gating, mode
 * validation, masked-secret preservation and the read-only connection probe.
 */

import './_safety'
import request from 'supertest'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { AuthService } from '../../src/services/auth.service'
import { PaymentSettingsService } from '../../src/services/payment-settings.service'
import {
  razorpayClient,
  clearRazorpayCredentialCache,
} from '../../src/integrations/razorpay/razorpay.client'
import { ServiceUnavailableError } from '../../src/utils/errors'

const app = createApp()
const COD_KEY = 'shipping_cod_enabled'

let adminToken: string
let originalCod: { value: string; isPublic: boolean } | null = null

async function getAdminSettings() {
  return request(app)
    .get('/api/v1/admin/payment-settings')
    .set('Authorization', `Bearer ${adminToken}`)
}

async function putAdminSettings(body: Record<string, unknown>) {
  return request(app)
    .put('/api/v1/admin/payment-settings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body)
}

const VALID_SAVE = {
  razorpayKeyId: 'rzp_test_admin_key_id',
  razorpayKeySecret: 'admin_key_secret_value',
  webhookSecret: 'admin_webhook_secret_value',
  enabledMethods: ['razorpay', 'upi'],
  onlineEnabled: true,
  testMode: true,
  codEnabled: false,
  codLimit: 1200,
}

beforeAll(async () => {
  const adminLogin = await AuthService.login({
    email: 'admin@vedhicfoods.com',
    password: 'Admin@Vedhic2026',
  })
  adminToken = adminLogin.accessToken

  const cod = await prisma.systemSetting.findUnique({ where: { key: COD_KEY } })
  originalCod = cod ? { value: cod.value, isPublic: cod.isPublic } : null
})

beforeEach(async () => {
  await prisma.paymentSettings.deleteMany({ where: { id: 'default' } })
  clearRazorpayCredentialCache()
})

afterAll(async () => {
  await prisma.paymentSettings.deleteMany({ where: { id: 'default' } })
  clearRazorpayCredentialCache()

  if (originalCod) {
    await prisma.systemSetting.upsert({
      where: { key: COD_KEY },
      update: { value: originalCod.value, isPublic: originalCod.isPublic },
      create: {
        key: COD_KEY,
        value: originalCod.value,
        isPublic: originalCod.isPublic,
      },
    })
  } else {
    await prisma.systemSetting.deleteMany({ where: { key: COD_KEY } })
  }
})

describe('admin-managed payment settings', () => {
  it('reports an unconfigured gateway without throwing', async () => {
    const res = await getAdminSettings()

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
    expect(res.body.webhookConfigured).toBe(false)
    expect(res.body.onlineEnabled).toBe(false)
    expect(res.body.configurationState).toBe('disabled')
    expect(res.body.razorpayKeySecretMasked).toBe('')
    expect(res.body.encryptionKeyConfigured).toBe(true)
  })

  it('refuses to enable online payments without a key id and secret', async () => {
    const noKeyId = await putAdminSettings({ onlineEnabled: true })
    expect(noKeyId.status).toBe(400)

    const noSecret = await putAdminSettings({
      razorpayKeyId: 'rzp_test_admin_key_id',
      onlineEnabled: true,
      testMode: true,
    })
    expect(noSecret.status).toBe(400)
  })

  it('saves credentials, never echoes plaintext, and drives the public config', async () => {
    const save = await putAdminSettings(VALID_SAVE)

    expect(save.status).toBe(200)
    expect(save.body.configured).toBe(true)
    expect(save.body.webhookConfigured).toBe(true)
    expect(save.body.onlineEnabled).toBe(true)
    expect(save.body.configurationState).toBe('ready_test')
    expect(save.body.keyIdMode).toBe('test')
    expect(save.body.razorpayKeySecretMasked).not.toContain(VALID_SAVE.razorpayKeySecret)
    expect(save.body.webhookSecretMasked).not.toContain(VALID_SAVE.webhookSecret)

    const stored = await prisma.paymentSettings.findUnique({ where: { id: 'default' } })
    expect(stored?.encryptedKeySecret.startsWith('v2:')).toBe(true)
    expect(stored?.encryptedWebhookSecret.startsWith('v2:')).toBe(true)
    expect(stored?.encryptedKeySecret).not.toContain(VALID_SAVE.razorpayKeySecret)

    const config = await request(app).get('/api/v1/payments/config')
    expect(config.status).toBe(200)
    expect(config.body.data.onlineEnabled).toBe(true)
    expect(config.body.data.configured).toBe(true)
    expect(config.body.data.testMode).toBe(true)
    expect(config.body.data.enabledMethods).toEqual(expect.arrayContaining(['razorpay', 'upi']))
    expect(config.body.data.codEnabled).toBe(false)
    expect(config.body.data.codLimit).toBe(1200)

    await expect(PaymentSettingsService.assertOnlinePaymentAllowed('razorpay')).resolves.toBeUndefined()
    await expect(PaymentSettingsService.assertOnlinePaymentAllowed('upi')).resolves.toBeUndefined()
  })

  it('keeps the stored secret when the masked value is posted back unchanged', async () => {
    const save = await putAdminSettings(VALID_SAVE)
    const firstMask = save.body.razorpayKeySecretMasked as string

    const resave = await putAdminSettings({
      razorpayKeyId: VALID_SAVE.razorpayKeyId,
      razorpayKeySecretMasked: firstMask,
      webhookSecretMasked: save.body.webhookSecretMasked,
      enabledMethods: ['razorpay'],
      onlineEnabled: true,
      testMode: true,
    })

    expect(resave.status).toBe(200)
    expect(resave.body.configured).toBe(true)
    expect(resave.body.razorpayKeySecretMasked).toBe(firstMask)

    const audited = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_SETTINGS_UPDATED' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audited).not.toBeNull()
  })

  it('rejects a test/live key that contradicts the selected mode', async () => {
    await putAdminSettings(VALID_SAVE)

    const liveKeyInTestMode = await putAdminSettings({
      razorpayKeyId: 'rzp_live_admin_key_id',
      testMode: true,
      onlineEnabled: true,
    })
    expect(liveKeyInTestMode.status).toBe(400)

    const testKeyInLiveMode = await putAdminSettings({ testMode: false })
    expect(testKeyInLiveMode.status).toBe(400)
  })

  it('fails closed for online payment when the operator disables it', async () => {
    await putAdminSettings({ ...VALID_SAVE, onlineEnabled: false })

    const config = await request(app).get('/api/v1/payments/config')
    expect(config.status).toBe(200)
    expect(config.body.data.onlineEnabled).toBe(false)

    await expect(
      PaymentSettingsService.assertOnlinePaymentAllowed('razorpay')
    ).rejects.toBeInstanceOf(ServiceUnavailableError)
  })

  it('probes the gateway without creating a charge', async () => {
    const spy = vi.spyOn(razorpayClient.orders as any, 'all').mockResolvedValue({ count: 0 })

    try {
      const res = await request(app)
        .post('/api/v1/admin/payment-settings/test')
        .set('Authorization', `Bearer ${adminToken}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.razorpayKeySecretMasked).toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

