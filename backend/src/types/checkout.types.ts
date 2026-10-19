import { z } from 'zod'
import { PaymentMethod, OrderStatus, PaymentStatus } from '@prisma/client'

/**
 * Control characters (including the NUL byte) are rejected outright: a NUL in a
 * text column reached Prisma and produced an unhandled 500 instead of a 400.
 * Messages are user-facing — the UI surfaces `issues[0].message` verbatim.
 */
// oxlint-disable-next-line no-control-regex -- deliberate: reject NUL/control bytes
const NO_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((value) => !NO_CONTROL_CHARS.test(value), `${label} contains invalid characters.`)

export const checkoutSchema = z.object({
  addressId: z.string().uuid('Invalid address ID format').optional(),
  address: z.object({
    fullName: text('Full name', 2, 100),
    phone: text('Mobile number', 10, 15),
    line1: text('Address line 1', 3, 200),
    line2: text('Address line 2', 0, 200).optional().nullable(),
    landmark: text('Landmark', 0, 100).optional().nullable(),
    city: text('City', 2, 100),
    state: text('State', 2, 100),
    pincode: text('PIN code', 6, 10),
    country: text('Country', 0, 100).default('India'),
  }).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.RAZORPAY),
  couponCode: text('Coupon code', 2, 50).optional().nullable(),
  notes: text('Notes', 0, 500).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().trim().min(1, 'Product ID or slug is required'),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(100, 'Quantity must be 100 or fewer'),
  })).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
}).refine(
  (data) => Boolean(data.addressId || data.address),
  { message: 'Either an addressId or an address payload must be provided for delivery' }
)

export type CheckoutInputDTO = z.infer<typeof checkoutSchema>

export const updateOrderStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  notes: z.string().trim().max(500).optional(),
})

export type UpdateOrderStatusDTO = z.infer<typeof updateOrderStatusSchema>

/**
 * Strict Order State Machine Transitions
 */
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.PENDING_PAYMENT, OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.FAILED],
  PENDING_PAYMENT: [OrderStatus.CONFIRMED, OrderStatus.PAYMENT_FAILED, OrderStatus.CANCELLED],
  PAYMENT_FAILED: [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  PROCESSING: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  PACKED: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [], // Terminal
  CANCELLED: [], // Terminal
  FAILED: [],    // Terminal
}

export interface CheckoutResponse {
  success: boolean
  orderId: string
  orderNumber: string
  invoiceId?: string | null
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
  currency: string
  couponCode?: string | null
  shippingAddress: {
    fullName: string
    phone: string
    line1: string
    line2?: string | null
    city: string
    state: string
    pincode: string
    country: string
  }
  paymentDetails?: {
    razorpayOrderId?: string
    amount: number
    currency: string
    keyId?: string
  } | null
  items: {
    id: string
    productId: string
    name: string
    sku: string
    unit: string
    price: number
    quantity: number
    subtotal: number
  }[]
  createdAt: string
}
