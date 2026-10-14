import { z } from 'zod'
import { PaymentMethod, OrderStatus, PaymentStatus } from '@prisma/client'

export const checkoutSchema = z.object({
  addressId: z.string().uuid('Invalid address ID format').optional(),
  address: z.object({
    fullName: z.string().trim().min(2).max(100),
    phone: z.string().trim().min(10).max(15),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional().nullable(),
    landmark: z.string().trim().max(100).optional().nullable(),
    city: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(100),
    pincode: z.string().trim().min(6).max(10),
    country: z.string().trim().default('India'),
  }).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.COD),
  couponCode: z.string().trim().min(2).max(50).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().trim().min(1, 'Product ID or slug is required'),
    quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(100),
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
