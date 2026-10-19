import type { ID } from './common'
import type { Product } from './catalog'

/* ------------------------------------------------------------------ Cart */

export interface CartItem {
  /** Composite key = productId (+ variant in future). */
  id: string
  productId: ID
  slug: string
  name: string
  image: string
  price: number
  mrp: number
  unit: string
  quantity: number
  stock: number
}

export interface CartTotals {
  subtotal: number
  savings: number
  shipping: number
  tax: number
  discount: number
  total: number
  itemCount: number
}

export interface AppliedCoupon {
  code: string
  label: string
  type: 'percent' | 'flat' | 'shipping'
  value: number
  amount: number
}

/* ---------------------------------------------------------------- Orders */

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'out-for-delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'

export type PaymentStatus = 'pending' | 'processing' | 'paid' | 'failed' | 'refunded'

export type PaymentMethod = 'razorpay' | 'upi' | 'card' | 'netbanking' | 'cod'

export interface OrderTimelineEntry {
  status: OrderStatus | 'placed' | 'paid'
  label: string
  note?: string
  /**
   * Backend orders carry no per-step history; the service synthesises the
   * ladder and stamps a timestamp only on the step it can prove (creation
   * time for step one, `updatedAt` for the current one).
   */
  at?: string
  completed: boolean
}

export interface Order {
  id: ID
  orderNumber: string
  customerId: ID
  customerName: string
  customerEmail: string
  items: OrderLineItem[]
  subtotal: number
  savings: number
  shipping: number
  tax: number
  discount: number
  total: number
  status: OrderStatus
  paymentStatus: PaymentStatus
  /** Absent on the admin list projection — only the detail endpoint includes it. */
  paymentMethod?: PaymentMethod
  /** Absent on the admin list projection — only the detail endpoint includes it. */
  address?: Address
  couponCode?: string
  timeline: OrderTimelineEntry[]
  placedAt: string
  updatedAt: string
  invoiceId?: ID
  trackingNumber?: string
  courier?: string
  notes?: string
}

export interface OrderLineItem {
  productId: ID
  name: string
  image: string
  unit: string
  price: number
  quantity: number
  sku: string
}

/* ----------------------------------------------------------- Address book */

export interface Address {
  id: ID
  label: string
  fullName: string
  phone: string
  line1: string
  line2?: string
  city: string
  state: string
  pincode: string
  country: string
  isDefault: boolean
}

/* --------------------------------------------------------------- Payments */

export type PaymentProvider = 'razorpay' | 'manual'

export interface Payment {
  id: ID
  orderId: ID
  provider: PaymentProvider
  method: PaymentMethod
  status: PaymentStatus
  amount: number
  currency: 'INR'
  transactionRef?: string
  gatewayOrderId?: string
  signature?: string
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export interface PaymentGatewaySettings {
  provider: PaymentProvider
  razorpayKeyId: string
  razorpayKeySecretMasked: string
  webhookSecretMasked: string
  enabledMethods: PaymentMethod[]
  testMode: boolean
  codEnabled: boolean
  codLimit: number
  /** True only when both key secret + webhook secret are stored server-side. */
  configured?: boolean
}

/* --------------------------------------------------------------- Invoices */

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled'

export interface Invoice {
  id: ID
  invoiceNumber: string
  orderId: ID
  orderNumber: string
  customerName: string
  customerEmail: string
  billingAddress: Address
  shippingAddress: Address
  items: OrderLineItem[]
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
  status: InvoiceStatus
  issuedAt: string
  dueAt: string
  gstin?: string
  notes?: string
}

/* -------------------------------------------------------------- Delivery */

export type DeliveryStatus =
  | 'unassigned'
  | 'assigned'
  | 'picked-up'
  | 'in-transit'
  | 'delivered'
  | 'failed'

export interface DeliveryPartner {
  id: ID
  name: string
  phone: string
  vehicle?: string
  active: boolean
}

export interface Delivery {
  id: ID
  orderId: ID
  orderNumber: string
  customerName: string
  city: string
  status: DeliveryStatus
  partnerId?: ID
  partnerName?: string
  trackingNumber?: string
  expectedAt: string
  deliveredAt?: string
}

/* ------------------------------------------------------------- Discounts */

export type DiscountType = 'percent' | 'flat' | 'shipping'

export interface Discount {
  id: ID
  code: string
  label: string
  type: DiscountType
  value: number
  minOrderValue: number
  maxUses: number
  usedCount: number
  appliesTo: 'all' | 'category' | 'product'
  targetIds: ID[]
  startsAt: string
  expiresAt: string
  active: boolean
}

export interface Promotion {
  id: ID
  title: string
  subtitle: string
  /** Banner artwork shown on the storefront (URL or data URL). */
  bannerImageUrl?: string
  /** Where the banner call-to-action leads. */
  destinationUrl?: string
  /** Optional call-to-action label, e.g. "Shop the sale". */
  ctaLabel?: string
  /** 'shipping' coupons are unsupported by the backend discount engine. */
  type: DiscountType
  value: number
  minOrderValue: number
  startsAt: string
  expiresAt: string
  active: boolean
  priority?: number
}

export interface CouponValidation {
  valid: boolean
  coupon?: AppliedCoupon
  error?: string
}

/* ---------------------------------------------------------------- Reviews */

export interface ProductReviewInput {
  productId: ID
  rating: number
  title: string
  body: string
  customerName: string
}

export type { Product }
