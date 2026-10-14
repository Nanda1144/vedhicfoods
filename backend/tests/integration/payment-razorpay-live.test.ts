/**
 * Razorpay LIVE gateway suite — BLOCKED until real sandbox credentials exist.
 *
 * This suite makes real calls to api.razorpay.com and is therefore gated on a
 * genuine `rzp_test_*` key pair. With the repository's placeholder credentials it
 * is SKIPPED (reported as BLOCKED), never stubbed into a fake success.
 *
 * Even with valid credentials, a full end-to-end CAPTURE cannot be automated:
 * Razorpay requires a human to enter a card/UPI credential in checkout. This
 * suite therefore proves the parts that do not require a customer: authenticated
 * order creation and authoritative order retrieval on the live gateway.
 *
 * To enable: set RAZORPAY_KEY_ID=rzp_test_... and RAZORPAY_KEY_SECRET=... in the
 * test environment (or configure them via the admin dashboard if this suite is
 * pointed at a live app instance) and re-run.
 */

import './_safety'
import { describe, it, expect } from 'vitest'
import { resolveRazorpayCredentials } from '../../src/integrations/razorpay/razorpay.client'
import { RazorpayService } from '../../src/integrations/razorpay/razorpay.service'
import { LIVE_RAZORPAY, RAZORPAY_CREDENTIALS } from './helpers/razorpay-testkit'

// A short, hard failure surface so a misconfigured run is obvious in the report.
describe.skipIf(!LIVE_RAZORPAY)('Razorpay live sandbox — authenticated gateway calls', () => {
  it('creates a real Razorpay order and reads it back', async () => {
    const session = await resolveRazorpayCredentials(true)
    expect(session.keyId).toMatch(/^rzp_test_/)

    // ₹1.00 in paise — a non-chargeable amount used purely to prove auth + round trip.
    const order = await RazorpayService.createOrder(
      {
        amountInPaise: 100,
        currency: 'INR',
        receipt: `live_probe_${Date.now()}`,
        notes: { purpose: 'integration_probe' },
      },
      session.client
    )

    expect(order.id).toMatch(/^order_/)
    expect(Number(order.amount)).toBe(100)
    expect(String(order.currency).toUpperCase()).toBe('INR')

    const fetched = await session.client.orders.fetch(order.id)
    expect(fetched.id).toBe(order.id)
  }, 30000)
})

// Always-present, non-skipped test so the run reports WHY live coverage is absent.
describe('Razorpay live readiness', () => {
  it('reports the live-gateway readiness status', () => {
    // Intentionally always passes; asserts the classification is coherent.
    if (RAZORPAY_CREDENTIALS.liveGatewayReady) {
      expect(LIVE_RAZORPAY).toBe(true)
      expect(RAZORPAY_CREDENTIALS.keyIdIsTestKey).toBe(true)
    } else {
      expect(LIVE_RAZORPAY).toBe(false)
      expect(RAZORPAY_CREDENTIALS.reason).toContain('BLOCKED')
    }
  })
})
