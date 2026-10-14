import { OrderStatus } from '@prisma/client'

/**
 * Order lifecycle transition rules.
 *
 * SECURITY / INTEGRITY: `PUT /admin/orders/:id/status` read `status` straight from
 * the request body and passed it to Prisma with no transition check:
 *
 *   const { status } = req.body
 *   await tx.order.update({ where: { id }, data: { status } })
 *
 * Any syntactically valid enum value was accepted from any state, so a single
 * request could move an unpaid order straight to DELIVERED. That breaks three
 * things at once: the fulfilment queue can be told an order shipped before payment
 * settled; `paymentStatus` and `status` stop describing the same order, so
 * reconciliation has nothing to trust; and because restocking only fired when the
 * *target* was CANCELLED/FAILED, skipping through those states leaves stock
 * permanently deducted with no corresponding reversal.
 *
 * Transitions are now explicit. The matrix is the contract; adding a state to the
 * Prisma enum without adding it here fails the build's type check rather than
 * silently widening the API.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED, OrderStatus.CANCELLED],

  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.CONFIRMED,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.CANCELLED,
  ],

  [OrderStatus.PAYMENT_FAILED]: [OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED, OrderStatus.CANCELLED],

  [OrderStatus.CONFIRMED]: [
    OrderStatus.PROCESSING,
    OrderStatus.PACKED,
    OrderStatus.CANCELLED,
    // An order can fail after confirmation (stock, quality, customer request).
    OrderStatus.FAILED,
  ],

  [OrderStatus.PROCESSING]: [OrderStatus.PACKED, OrderStatus.FAILED, OrderStatus.CANCELLED],

  [OrderStatus.PACKED]: [OrderStatus.SHIPPED, OrderStatus.FAILED, OrderStatus.CANCELLED],

  [OrderStatus.SHIPPED]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED],

  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.FAILED],

  // Terminal: a delivered order is never reopened. Returns are handled through the
  // refund path, which owns its own state, not by editing order status.
  [OrderStatus.DELIVERED]: [],

  [OrderStatus.CANCELLED]: [],
  [OrderStatus.FAILED]: [],
}

export function allowedOrderTransitions(status: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[status] ?? []
}

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return allowedOrderTransitions(from).includes(to)
}

/** Statuses from which stock must be returned to available inventory. */
const RESTOCKING_FROM: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.FAILED,
]

/**
 * True when a transition must release reserved inventory.
 *
 * The previous condition compared against literal strings `'CANCELLED'` and
 * `'FAILED'` only. Centralising the list means any future restocking state has to
 * be declared here, where the transition matrix and the inventory effect sit
 * together, instead of being added to one and forgotten in the other.
 */
export function shouldRestockOnTransition(from: OrderStatus, to: OrderStatus): boolean {
  return RESTOCKING_FROM.includes(to) && !RESTOCKING_FROM.includes(from)
}

/** What must happen to inventory when an order moves `from -> to`. */
export type InventoryDisposition = 'release' | 'restock' | 'none'

/**
 * Statuses where the order never deducted stock — an online order that hasn't
 * been captured only holds a reservation, so reverting it must release the
 * reservation instead of crediting sold stock.
 */
const RESERVATION_ONLY_FROM: ReadonlySet<OrderStatus> = new Set([OrderStatus.PENDING_PAYMENT])

/**
 * Statuses where the order's stock was fully deducted from available inventory
 * and counted as sold.
 */
const DEDUCTED_FROM: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.OUT_FOR_DELIVERY,
])

/**
 * Statuses that hold no stock at all: PENDING never reserved anything, and
 * PAYMENT_FAILED/FAILED/CANCELLED already released or restocked on the way in.
 * Transitions out of these must be inert or inventory would be double-credited.
 */
const NO_ALLOCATION_FROM: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PENDING,
  OrderStatus.PAYMENT_FAILED,
  OrderStatus.FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.DELIVERED,
])

/**
 * Chooses the correct inventory effect for a status transition.
 *
 * The previous `shouldRestockOnTransition` only said "restock or not", but the
 * admin endpoint blindly applied `restockOrder` for any CANCELLED/FAILED target
 * — cancelling an unpaid order still in PENDING_PAYMENT called `restockOrder`,
 * which increments `availableQuantity`, decrements `soldQuantity` (never counted
 * as sold) and leaves `reservedQuantity` permanently reserved. That corrupts all
 * three counters. The disposition is derived from the FROM state:
 *
 *   'release' — the order only held a reservation (PENDING_PAYMENT) that must be
 *               returned to available without touching the sold count.
 *   'restock' — the order was fully deducted and counted as sold; return it to
 *               available and reverse the sold count.
 *   'none'    — nothing was reserved/deducted yet, or the stock was already
 *               disposed of on the way into the current state.
 */
export function inventoryDispositionForTransition(from: OrderStatus, to: OrderStatus): InventoryDisposition {
  if (!isValidOrderTransition(from, to)) return 'none'
  if (!RESTOCKING_FROM.includes(to)) return 'none'
  if (RESERVATION_ONLY_FROM.has(from)) return 'release'
  if (DEDUCTED_FROM.has(from)) return 'restock'
  if (NO_ALLOCATION_FROM.has(from)) return 'none'
  return 'none'
}