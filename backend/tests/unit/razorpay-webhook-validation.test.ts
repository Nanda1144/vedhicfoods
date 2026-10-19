import { describe, expect, it } from 'vitest'
import { validateCapturedWebhookEntity } from '../../src/integrations/razorpay/razorpay.service'

describe('captured Razorpay webhook validation', () => {
  const validEntity = {
    id: 'pay_test12345678',
    order_id: 'order_test12345678',
    amount: 12500,
    currency: 'INR',
    status: 'captured',
    method: 'upi',
  }

  it('accepts a complete captured settlement payload', () => {
    expect(() => validateCapturedWebhookEntity(validEntity)).not.toThrow()
  })

  it.each([
    ['missing amount', { ...validEntity, amount: undefined }],
    ['non-integer amount', { ...validEntity, amount: 100.5 }],
    ['zero amount', { ...validEntity, amount: 0 }],
    ['missing currency', { ...validEntity, currency: undefined }],
    ['invalid currency', { ...validEntity, currency: 'rupees' }],
    ['missing payment id', { ...validEntity, id: undefined }],
    ['missing gateway order id', { ...validEntity, order_id: undefined }],
    ['non-captured status', { ...validEntity, status: 'authorized' }],
  ])('rejects %s before any payment state changes', (_case, entity) => {
    expect(() => validateCapturedWebhookEntity(entity)).toThrow('Invalid captured payment webhook payload')
  })
})
