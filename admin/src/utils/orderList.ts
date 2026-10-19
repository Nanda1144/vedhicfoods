import type { Order, OrderStatus } from '@/types'

/**
 * Pure list logic for the admin orders table.
 *
 * Extracted from `AdminOrdersPage` so the search/status/payment predicates and
 * the pagination window can be pinned by tests without rendering the page or
 * stubbing the transport. The component holds these in a `useMemo`; keeping the
 * rules here means a regression in the matching behaviour is a unit-test failure
 * rather than a silent empty table.
 */

export interface OrderListFilters {
  search: string
  status: OrderStatus | 'all'
  payment: string
}

/** Case-insensitive match across order number, customer name and email. */
export function matchesOrderQuery(order: Order, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${order.orderNumber} ${order.customerName} ${order.customerEmail}`.toLowerCase().includes(needle)
}

export function filterOrders(orders: readonly Order[], filters: OrderListFilters): Order[] {
  return orders.filter((order) => {
    if (!matchesOrderQuery(order, filters.search)) return false
    if (filters.status !== 'all' && order.status !== filters.status) return false
    if (filters.payment && order.paymentStatus !== filters.payment) return false
    return true
  })
}

/** One-based page window; out-of-range pages yield an empty slice rather than throwing. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize)
}

/** Always at least one page so the pagination bar renders a stable "1 of 1". */
export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
