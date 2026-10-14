import type {
  Address,
  Order,
  OrderLineItem,
  OrderStatus,
  OrderTimelineEntry,
  PaymentMethod,
  PaymentStatus,
} from '@/types'

/**
 * Normalises the backend's Prisma-shaped order payload into the frontend
 * `Order` type. Server statuses are uppercase enums; checkout responses carry a
 * subset of fields; `items`/`shippingAddressSnapshot` and the item projections
 * differ between checkout, `GET /orders` and `GET /orders/my-orders`. This
 * absorbs all of it so order pages never crash on a partial payload.
 */

const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  PENDING: 'pending',
  PENDING_PAYMENT: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'confirmed',
  PACKED: 'packed',
  SHIPPED: 'shipped',
  OUT_FOR_DELIVERY: 'out-for-delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  FAILED: 'cancelled',
  RETURNED: 'returned',
}

const PAYMENT_STATUS_MAP: Record<string, PaymentStatus> = {
  PAID: 'paid',
  PENDING: 'pending',
  PROCESSING: 'processing',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  REFUNDING: 'refunded',
}

const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  RAZORPAY: 'razorpay',
  COD: 'cod',
  UPI: 'upi',
  CARD: 'card',
  NETBANKING: 'netbanking',
}

const PROGRESSION: Array<OrderStatus | 'placed' | 'paid'> = [
  'placed',
  'paid',
  'confirmed',
  'packed',
  'shipped',
  'out-for-delivery',
  'delivered',
]

const STAGE_LABELS: Record<string, string> = {
  placed: 'Order placed',
  paid: 'Payment received',
  confirmed: 'Order confirmed',
  packed: 'Packed',
  shipped: 'Shipped',
  'out-for-delivery': 'Out for delivery',
  delivered: 'Delivered',
}

function normalizeStatus(raw: unknown): OrderStatus {
  const value = typeof raw === 'string' ? raw.toUpperCase() : ''
  return ORDER_STATUS_MAP[value] ?? 'pending'
}

function normalizePaymentStatus(raw: unknown): PaymentStatus {
  const value = typeof raw === 'string' ? raw.toUpperCase() : ''
  return PAYMENT_STATUS_MAP[value] ?? 'pending'
}

function normalizePaymentMethod(raw: unknown): PaymentMethod {
  const value = typeof raw === 'string' ? raw.toUpperCase() : ''
  return PAYMENT_METHOD_MAP[value] ?? (value.toLowerCase() as PaymentMethod)
}

function toNumber(raw: unknown): number {
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

function normalizeAddress(raw: unknown): Address {
  const source =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {}
  return {
    id: '',
    label: 'Delivery',
    fullName: String(source.fullName ?? source.name ?? ''),
    phone: String(source.phone ?? ''),
    line1: String(source.line1 ?? source.addressLine ?? ''),
    line2: source.line2 ? String(source.line2) : undefined,
    city: String(source.city ?? ''),
    state: String(source.state ?? ''),
    pincode: String(source.pincode ?? source.pinCode ?? ''),
    country: String(source.country ?? 'India'),
    isDefault: false,
  }
}

function normalizeItems(raw: unknown): OrderLineItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const item =
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    return {
      productId: String(item.productId ?? item.id ?? ''),
      name: String(item.name ?? 'Item'),
      image: item.image ? String(item.image) : '',
      unit: String(item.unit ?? item.unitName ?? 'piece'),
      price: toNumber(item.price),
      quantity: Math.max(0, Math.round(toNumber(item.quantity))),
      sku: String(item.sku ?? ''),
    }
  })
}

function deriveTimeline(payload: {
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  placedAt: string
  updatedAt: string
}): OrderTimelineEntry[] {
  if (payload.status === 'cancelled') {
    return [
      { status: 'placed', label: 'Order placed', completed: true, at: payload.placedAt },
      {
        status: 'cancelled',
        label: 'Order cancelled',
        completed: true,
        at: payload.updatedAt,
        note: 'Any reserved stock was released back to inventory.',
      },
    ]
  }

  const reached: Set<string> = new Set()
  for (const stage of PROGRESSION) {
    reached.add(stage)
    if (stage === payload.status) break
  }

  // A paid order has clearly reached the payment stage even when the status
  // enum returned from checkout hasn't moved past PENDING yet.
  if (payload.paymentStatus === 'paid') reached.add('paid')

  return PROGRESSION.map((stage) => {
    const completed = reached.has(stage)
    return {
      status: stage,
      label:
        stage === 'paid' && payload.paymentMethod === 'cod'
          ? 'Payment on delivery'
          : STAGE_LABELS[stage] ?? stage,
      at: completed ? payload.placedAt : '',
      completed,
    }
  })
}

/** Converts a backend order payload (any of the vendor shapes) to a `Order`. */
export function normalizeOrder(raw: Record<string, any>): Order {
  const status = normalizeStatus(raw.status ?? raw.orderStatus)
  const paymentStatus = normalizePaymentStatus(raw.paymentStatus)
  const paymentMethod = normalizePaymentMethod(raw.paymentMethod ?? raw.method)

  const placedAt = raw.placedAt ?? raw.createdAt ?? new Date().toISOString()
  const updatedAt = raw.updatedAt ?? raw.createdAt ?? placedAt

  const addressSource = raw.shippingAddressSnapshot ?? raw.shippingAddress ?? raw.address ?? raw.billingAddress
  const address = normalizeAddress(addressSource)

  // Variant field the backend agent is adding to the checkout response.
  const deliveredAt = raw.deliveredAt || undefined

  return {
    id: String(raw.id ?? raw.orderId ?? ''),
    orderNumber: String(raw.orderNumber ?? ''),
    customerId: String(raw.userId ?? raw.customerId ?? ''),
    customerName: String(raw.customerName ?? raw.fullName ?? ''),
    customerEmail: String(raw.customerEmail ?? raw.email ?? ''),
    items: normalizeItems(raw.items),
    subtotal: toNumber(raw.subtotal ?? raw.itemsTotal),
    savings: toNumber(raw.savings ?? raw.discountOnMrp ?? 0),
    shipping: toNumber(raw.shipping ?? raw.shippingCharge ?? 0),
    tax: toNumber(raw.tax ?? raw.taxAmount ?? 0),
    discount: toNumber(raw.discount ?? raw.couponDiscount ?? 0),
    total: toNumber(raw.total ?? raw.grandTotal ?? raw.amount ?? 0),
    status,
    paymentStatus,
    paymentMethod,
    address,
    couponCode: raw.couponCode ? String(raw.couponCode) : undefined,
    timeline: Array.isArray(raw.timeline)
      ? raw.timeline.map((entry: Record<string, any>) => ({
          status: (String(entry.status ?? '').toLowerCase() || 'placed') as OrderTimelineEntry['status'],
          label: String(entry.label ?? STAGE_LABELS[String(entry.status).toLowerCase()] ?? entry.status ?? ''),
          note: entry.note ? String(entry.note) : undefined,
          at: entry.at ? String(entry.at) : '',
          completed: Boolean(entry.completed),
        }))
      : deriveTimeline({ status, paymentStatus, paymentMethod, placedAt, updatedAt }),
    placedAt,
    updatedAt,
    invoiceId: raw.invoiceId ? String(raw.invoiceId) : undefined,
    trackingNumber: raw.trackingNumber ? String(raw.trackingNumber) : undefined,
    courier: raw.courier ? String(raw.courier) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
    ...(deliveredAt ? { deliveredAt } : {}),
  }
}

export { normalizeStatus, normalizePaymentStatus, normalizePaymentMethod }