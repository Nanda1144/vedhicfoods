import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit coverage for the remote half of payment reconciliation.
 *
 * The remote fetch used to be a stub that always returned an empty list, which
 * silently turned every local payment into a `missing_remote` mismatch. These
 * tests pin the real behaviour: units, paging, and the refusal to produce a
 * report when the gateway cannot be reached.
 */
vi.mock('../../src/config/database', () => ({ prisma: {} }))

vi.mock('../../src/integrations/razorpay/razorpay.client', () => ({
  razorpayClient: { payments: { all: vi.fn() } },
}))

import { ReconciliationService } from '../../src/services/reconciliation.service'
import { razorpayClient } from '../../src/integrations/razorpay/razorpay.client'

const paymentsAll = vi.mocked(razorpayClient.payments.all)

function remotePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    entity: 'payment',
    order_id: 'order_1',
    amount: 50000,
    currency: 'INR',
    status: 'captured',
    ...overrides,
  }
}

function page(items: unknown[]) {
  return { entity: 'collection', count: items.length, items } as any
}

const fetchRemotePayments = (
  from: Date,
  to: Date,
): Promise<Array<{ razorpayOrderId: string; paymentId: string; amount: number; currency: string; status: string }>> =>
  (ReconciliationService as any).fetchRemotePayments(from, to)

beforeEach(() => {
  paymentsAll.mockReset()
})

describe('ReconciliationService remote fetch', () => {
  it('converts gateway paise to rupees and pages until the window is exhausted', async () => {
    paymentsAll
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, () => remotePayment())))
      .mockResolvedValueOnce(page([remotePayment({ id: 'pay_101', order_id: 'order_101' })]))

    const from = new Date('2026-09-01T00:00:00.000Z')
    const to = new Date('2026-10-01T00:00:00.000Z')
    const result = await fetchRemotePayments(from, to)

    expect(result).toHaveLength(101)
    expect(result.every((payment) => payment.amount === 500)).toBe(true)
    expect(result[100].razorpayOrderId).toBe('order_101')

    expect(paymentsAll).toHaveBeenCalledTimes(2)
    expect(paymentsAll).toHaveBeenNthCalledWith(1, {
      from: Math.floor(from.getTime() / 1000),
      to: Math.ceil(to.getTime() / 1000),
      count: 100,
      skip: 0,
    })
    expect(paymentsAll).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 100 }))
  })

  it('keeps only payments that carry an order id', async () => {
    paymentsAll.mockResolvedValueOnce(
      page([remotePayment({ id: 'pay_a', order_id: 'order_a' }), remotePayment({ id: 'pay_b', order_id: '' })]),
    )

    const result = await fetchRemotePayments(new Date(0), new Date())

    expect(result).toHaveLength(1)
    expect(result[0].paymentId).toBe('pay_a')
  })

  it('refuses to produce a report when the gateway call fails', async () => {
    paymentsAll.mockRejectedValueOnce(new Error('socket hang up'))

    await expect(fetchRemotePayments(new Date(0), new Date())).rejects.toMatchObject({
      statusCode: 503,
      code: 'PAYMENT_ERROR',
    })
  })

  it('does not hang when the gateway never answers', async () => {
    vi.useFakeTimers()
    try {
      paymentsAll.mockImplementation(() => new Promise(() => {}))

      const pending = fetchRemotePayments(new Date(0), new Date())
      const assertion = expect(pending).rejects.toMatchObject({
        statusCode: 503,
        code: 'PAYMENT_ERROR',
      })
      await vi.advanceTimersByTimeAsync(30_001)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a window past the row cap instead of returning a truncated set', async () => {
    paymentsAll.mockImplementation(async () => page(Array.from({ length: 100 }, () => remotePayment())))

    await expect(fetchRemotePayments(new Date(0), new Date())).rejects.toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    })
    expect(paymentsAll.mock.calls.length).toBeGreaterThan(10)
  })

  it("treats Razorpay's 'created' as the local 'pending' state", () => {
    const normalizeStatus = (status: unknown) =>
      (ReconciliationService as any).normalizeStatus(status)

    expect(normalizeStatus('created')).toBe('pending')
    expect(normalizeStatus('PENDING')).toBe('pending')
    expect(normalizeStatus('captured')).toBe('captured')
    expect(normalizeStatus('AUTHORIZED')).toBe('authorized')
    expect(normalizeStatus(null)).toBe('unknown')
  })
})

afterEach(() => {
  vi.useRealTimers()
})
