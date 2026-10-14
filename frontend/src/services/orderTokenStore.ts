import { storage } from '@/utils/storage'

const ORDER_TOKENS_KEY = 'vedhic.order.tokens.v1'

/**
 * Client-side registry of anonymous order-access tokens.
 *
 * Anonymous checkout returns a short-lived, order-bound JWT so the browser can
 * initiate/verify the Razorpay payment and read the order + invoice it just
 * placed without holding account credentials. Tokens expire server-side (~1h),
 * so a guest revisiting an old order simply gets a 401 and the pages fall back
 * to the data captured at checkout time.
 *
 * This is the ONLY legitimate order data persisted on the client — it stores
 * an authorisation credential, never order business data.
 */
const tokens: Record<string, string> = {}

try {
  Object.assign(tokens, storage.get<Record<string, string>>(ORDER_TOKENS_KEY, {}))
} catch {
  /* tolerate a corrupted payload */
}

function persist(): void {
  try {
    storage.set(ORDER_TOKENS_KEY, tokens)
  } catch {
    /* quota failures must not break checkout */
  }
}

export const orderTokenStore = {
  /**
   * Indexes the token under the order id, the human-readable order number and
   * any invoice aliases so invoice pages belonging to the same anonymous order
   * can resolve their token without needing account credentials.
   */
  save(input: { orderId: string; orderNumber?: string; invoiceId?: string | null; token: string }): void {
    tokens[input.orderId] = input.token
    if (input.orderNumber) tokens[input.orderNumber] = input.token
    if (input.invoiceId) tokens[input.invoiceId] = input.token
    persist()
  },

  /** Looks up by either the order id or the order number. */
  get(orderIdOrNumber: string): string | null {
    return tokens[orderIdOrNumber] ?? null
  },

  remove(orderIdOrNumber: string): void {
    delete tokens[orderIdOrNumber]
    persist()
  },
}