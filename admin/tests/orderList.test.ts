import { describe, expect, it } from 'vitest'
import { filterOrders, matchesOrderQuery, pageCountFor, paginate } from '@/utils/orderList'
import type { OrderListFilters } from '@/utils/orderList'
import type { Order, OrderStatus, PaymentStatus } from '@/types'

/**
 * The orders table is the operator's only view of live orders, and its search
 * runs purely client-side over the fetched page. A regression here does not
 * throw — it quietly returns the wrong rows (or an empty table), which is exactly
 * the failure mode that is hard to notice in review. These tests pin the actual
 * predicate rules: one trimmed, case-insensitive match across order number,
 * customer name and email, AND-combined with the status and payment filters.
 */

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    orderNumber: 'VF-1001',
    customerId: 'usr_1',
    customerName: 'Asha Rao',
    customerEmail: 'asha@example.com',
    items: [],
    subtotal: 1000,
    savings: 0,
    shipping: 50,
    tax: 180.5,
    discount: 0,
    total: 1230.5,
    status: 'confirmed',
    paymentStatus: 'paid',
    timeline: [],
    placedAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  }
}

const ALL: OrderListFilters = { search: '', status: 'all', payment: '' }

const ORDERS: Order[] = [
  order({ id: 'a', orderNumber: 'VF-1001', customerName: 'Asha Rao', customerEmail: 'asha@example.com', status: 'pending', paymentStatus: 'pending' }),
  order({ id: 'b', orderNumber: 'VF-1002', customerName: 'Bharat Menon', customerEmail: 'bharat@example.com', status: 'shipped', paymentStatus: 'paid' }),
  order({ id: 'c', orderNumber: 'VF-1003', customerName: 'Chitra Iyer', customerEmail: 'chitra@corp.example', status: 'delivered', paymentStatus: 'refunded' }),
]

describe('filterOrders', () => {
  it('returns every order when no filter is active', () => {
    expect(filterOrders(ORDERS, ALL).map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('matches a search term against the order number', () => {
    expect(filterOrders(ORDERS, { ...ALL, search: 'VF-1002' }).map((o) => o.id)).toEqual(['b'])
  })

  it('matches a search term against the customer name', () => {
    expect(filterOrders(ORDERS, { ...ALL, search: 'chitra' }).map((o) => o.id)).toEqual(['c'])
  })

  it('matches a search term against the customer email', () => {
    expect(filterOrders(ORDERS, { ...ALL, search: 'corp.example' }).map((o) => o.id)).toEqual(['c'])
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(filterOrders(ORDERS, { ...ALL, search: '  ASHA  ' }).map((o) => o.id)).toEqual(['a'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterOrders(ORDERS, { ...ALL, search: 'zzz' })).toEqual([])
  })

  it('filters by status, and `all` disables the status predicate', () => {
    expect(filterOrders(ORDERS, { ...ALL, status: 'shipped' }).map((o) => o.id)).toEqual(['b'])
    expect(filterOrders(ORDERS, { ...ALL, status: 'all' })).toHaveLength(3)
  })

  it('filters by payment status', () => {
    expect(filterOrders(ORDERS, { ...ALL, payment: 'refunded' }).map((o) => o.id)).toEqual(['c'])
    expect(filterOrders(ORDERS, { ...ALL, payment: 'paid' }).map((o) => o.id)).toEqual(['b'])
  })

  it('AND-combines search, status and payment filters', () => {
    expect(filterOrders(ORDERS, { search: 'VF-1002', status: 'shipped', payment: 'paid' }).map((o) => o.id)).toEqual(['b'])
    expect(filterOrders(ORDERS, { search: 'VF-1002', status: 'delivered', payment: 'paid' })).toEqual([])
  })

  it('treats a returned order status value as a plain equality check', () => {
    const returned: OrderStatus = 'returned'
    expect(filterOrders([order({ id: 'r', status: returned })], { ...ALL, status: returned }).map((o) => o.id)).toEqual(['r'])
  })

  it('narrows the payment comparison without type coercion surprises', () => {
    const failed: PaymentStatus = 'failed'
    expect(filterOrders([order({ id: 'f', paymentStatus: failed })], { ...ALL, payment: failed }).map((o) => o.id)).toEqual(['f'])
  })
})

describe('matchesOrderQuery', () => {
  it('is true for any order when the query is empty or blank', () => {
    expect(matchesOrderQuery(ORDERS[0]!, '')).toBe(true)
    expect(matchesOrderQuery(ORDERS[0]!, '   ')).toBe(true)
  })
})

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1)

  it('slices the requested one-based page window', () => {
    expect(paginate(items, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(paginate(items, 3, 10)).toEqual([21, 22, 23, 24, 25])
  })

  it('returns an empty window past the end instead of throwing', () => {
    expect(paginate(items, 9, 10)).toEqual([])
  })

  it('handles an empty source', () => {
    expect(paginate([] as number[], 1, 10)).toEqual([])
  })
})

describe('pageCountFor', () => {
  it('rounds up to whole pages', () => {
    expect(pageCountFor(0, 10)).toBe(1)
    expect(pageCountFor(1, 10)).toBe(1)
    expect(pageCountFor(10, 10)).toBe(1)
    expect(pageCountFor(11, 10)).toBe(2)
    expect(pageCountFor(100, 10)).toBe(10)
  })
})
