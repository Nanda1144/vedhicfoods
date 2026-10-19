import { describe, expect, it } from 'vitest'
import { orderAccessTokenMatchesOrder, type OrderAccessTokenClaims } from '../../src/utils/order-token'

describe('guest order access token scope', () => {
  const claims: OrderAccessTokenClaims = {
    userId: 'guest-user',
    email: 'guest@example.test',
    orderId: 'order-a',
    tokenType: 'order',
  }

  it('allows the order that minted the token', () => {
    expect(orderAccessTokenMatchesOrder(claims, 'order-a')).toBe(true)
  })

  it('rejects another order owned by the same guest account', () => {
    expect(orderAccessTokenMatchesOrder(claims, 'order-b')).toBe(false)
  })

  it('does not restrict an authenticated session without an order token', () => {
    expect(orderAccessTokenMatchesOrder(undefined, 'order-b')).toBe(true)
  })
})
