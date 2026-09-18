import { storage } from '@/utils/storage'
import type { Order } from '@/types'

const ORDERS_KEY = 'vedhi.orders.v1'

/**
 * Client-side registry of freshly placed orders.
 *
 * In production these orders live in the backend and are fetched by id/number
 * from the API. The prototype persists them to localStorage so that the
 * `/order-success/:number` and `/invoice/:id` pages survive a reload without
 * falling back to seed data.
 */
const byId = new Map<string, Order>()
const byNumber = new Map<string, Order>()

try {
  const saved = storage.get<Order[]>(ORDERS_KEY, [])
  for (const order of saved) {
    byId.set(order.id, order)
    byNumber.set(order.orderNumber, order)
  }
} catch {
  /* ignore corrupted storage payloads */
}

function persist() {
  try {
    storage.set(ORDERS_KEY, Array.from(byId.values()))
  } catch {
    /* quota or serialisation issues must not break checkout */
  }
}

export const orderStore = {
  save(order: Order): void {
    byId.set(order.id, order)
    byNumber.set(order.orderNumber, order)
    persist()
  },

  byId(id: string): Order | undefined {
    return byId.get(id)
  },

  byNumber(orderNumber: string): Order | undefined {
    return byNumber.get(orderNumber)
  },

  all(): Order[] {
    return Array.from(byId.values())
  },
}