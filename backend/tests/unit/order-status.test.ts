/**
 * Order state-machine regression tests.
 *
 * DB-free: the transition matrix and the inventory disposition it drives are
 * pure logic, so they run in CI without PostgreSQL. They lock in the fix where
 * the admin endpoint blindly `restockOrder`ed a PENDING_PAYMENT order — which
 * only holds a reservation — corrupting availableQuantity, soldQuantity and
 * reservedQuantity at once.
 */

import { describe, it, expect } from 'vitest'
import { OrderStatus } from '@prisma/client'
import {
  allowedOrderTransitions,
  inventoryDispositionForTransition,
  isValidOrderTransition,
  shouldRestockOnTransition,
} from '../../src/utils/order-status'

/**
 * Deducted statuses: stock counted as sold. Must be RESTOCKED on reversal.
 */
const DEDUCTED: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
]

/**
 * Statuses that hold stock they must give back (unreserve): an order that never
 * passed capture only holds a reservation.
 */
const RESERVATION_ONLY: OrderStatus[] = [OrderStatus.PENDING_PAYMENT]

/**
 * Statuses holding nothing: restocking/releasing them would double-credit.
 */
const NO_ALLOCATION: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.PAYMENT_FAILED,
]

describe('inventoryDispositionForTransition', () => {
  it('releases the reservation when an unpaid order is cancelled', () => {
    // Regression: the admin endpoint used to restockOrder from here, crediting
    // sold + available while leaving the reservation permanently reserved.
    expect(inventoryDispositionForTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED)).toBe('release')
  })

  it('does not release when the reservation was already returned on payment failure', () => {
    expect(inventoryDispositionForTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.CANCELLED)).toBe('none')
    expect(inventoryDispositionForTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.PENDING_PAYMENT)).toBe('none')
    expect(inventoryDispositionForTransition(OrderStatus.PAYMENT_FAILED, OrderStatus.CONFIRMED)).toBe('none')
  })

  it('does nothing for PENDING, which never reserved or deducted stock', () => {
    expect(inventoryDispositionForTransition(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe('none')
    expect(inventoryDispositionForTransition(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe('none')
  })

  it('restocks every deducted status into either restocking target', () => {
    for (const from of DEDUCTED) {
      for (const to of [OrderStatus.CANCELLED, OrderStatus.FAILED]) {
        if (isValidOrderTransition(from, to)) {
          expect(inventoryDispositionForTransition(from, to)).toBe('restock')
        }
      }
    }

    expect(inventoryDispositionForTransition(OrderStatus.CONFIRMED, OrderStatus.CANCELLED)).toBe('restock')
    expect(inventoryDispositionForTransition(OrderStatus.CONFIRMED, OrderStatus.FAILED)).toBe('restock')
    expect(inventoryDispositionForTransition(OrderStatus.PROCESSING, OrderStatus.FAILED)).toBe('restock')
    expect(inventoryDispositionForTransition(OrderStatus.PACKED, OrderStatus.FAILED)).toBe('restock')
    expect(inventoryDispositionForTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.FAILED)).toBe('restock')
  })

  it('returns none for terminal and non-restocking transitions', () => {
    expect(inventoryDispositionForTransition(OrderStatus.CANCELLED, OrderStatus.CANCELLED)).toBe('none')
    expect(inventoryDispositionForTransition(OrderStatus.FAILED, OrderStatus.FAILED)).toBe('none')
    expect(inventoryDispositionForTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe('none')
    expect(inventoryDispositionForTransition(OrderStatus.PACKED, OrderStatus.SHIPPED)).toBe('none')
  })
})

describe('transition matrix', () => {
  it('keeps shouldRestockOnTransition contract for deducted orders', () => {
    expect(shouldRestockOnTransition(OrderStatus.CONFIRMED, OrderStatus.CANCELLED)).toBe(true)
    expect(shouldRestockOnTransition(OrderStatus.PROCESSING, OrderStatus.FAILED)).toBe(true)
    expect(shouldRestockOnTransition(OrderStatus.CANCELLED, OrderStatus.CANCELLED)).toBe(false)
    expect(shouldRestockOnTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe(false)
  })

  it('terminal statuses allow no further transitions', () => {
    for (const terminal of [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.FAILED]) {
      expect(allowedOrderTransitions(terminal)).toEqual([])
    }
  })

  it('never permits an unpaid or mid-fulfilment order to skip to DELIVERED', () => {
    // SHIPPED may be marked DELIVERED directly (armed courier), but an order must
    // not reach DELIVERED while payment is still pending or fulfilment is mid-run.
    for (const from of [OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.PACKED]) {
      expect(isValidOrderTransition(from, OrderStatus.DELIVERED)).toBe(false)
    }
    expect(isValidOrderTransition(OrderStatus.SHIPPED, OrderStatus.DELIVERED)).toBe(true)
  })

  it('resolves every non-terminal/restocking target consistently', () => {
    // Every status that can legally enter CANCELLED/FAILED must have an explicit
    // inventory answer (release | restock | none) — never a silent gap.
    for (const from of Object.values(OrderStatus)) {
      for (const to of [OrderStatus.CANCELLED, OrderStatus.FAILED]) {
        if (isValidOrderTransition(from, to)) {
          expect(['release', 'restock', 'none']).toContain(inventoryDispositionForTransition(from, to))
        }
      }
    }
  })
})