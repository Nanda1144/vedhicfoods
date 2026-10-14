import { z } from 'zod'
import { DeliveryStatus, OrderStatus, PaymentStatus } from '@prisma/client'

export { DeliveryStatus }

/**
 * Controlled delivery states required by the specification:
 * PENDING, ASSIGNED, PACKED, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, FAILED, RETURNED, CANCELLED
 */
export const CONTROLLED_DELIVERY_STATUSES = [
  DeliveryStatus.PENDING,
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.PACKED,
  DeliveryStatus.SHIPPED,
  DeliveryStatus.OUT_FOR_DELIVERY,
  DeliveryStatus.DELIVERED,
  DeliveryStatus.FAILED,
  DeliveryStatus.RETURNED,
  DeliveryStatus.CANCELLED,
] as const

/**
 * Valid delivery state transition matrix.
 * Enforces strict sequential order fulfillment and terminal state rules.
 */
export const VALID_DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.PENDING]: [
    DeliveryStatus.ASSIGNED,
    DeliveryStatus.PACKED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.ASSIGNED]: [
    DeliveryStatus.PACKED,
    DeliveryStatus.SHIPPED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.PACKED]: [
    DeliveryStatus.ASSIGNED,
    DeliveryStatus.SHIPPED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.SHIPPED]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.FAILED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.OUT_FOR_DELIVERY]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.FAILED,
    DeliveryStatus.RETURNED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.DELIVERED]: [], // Terminal state: Cannot transition once delivered
  [DeliveryStatus.FAILED]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.RETURNED,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.RETURNED]: [
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.CANCELLED]: [], // Terminal state: Cannot transition once cancelled
  // Backward compatibility safety fallbacks for transitional states:
  [DeliveryStatus.PICKED_UP]: [
    DeliveryStatus.IN_TRANSIT,
    DeliveryStatus.SHIPPED,
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.CANCELLED,
  ],
  [DeliveryStatus.IN_TRANSIT]: [
    DeliveryStatus.OUT_FOR_DELIVERY,
    DeliveryStatus.DELIVERED,
    DeliveryStatus.FAILED,
    DeliveryStatus.CANCELLED,
  ],
}

/**
 * Mapping between DeliveryStatus and corresponding OrderStatus.
 * Synchronizes order lifecycle with physical delivery progress.
 */
export const DELIVERY_TO_ORDER_STATUS_MAP: Partial<Record<DeliveryStatus, OrderStatus>> = {
  [DeliveryStatus.PACKED]: OrderStatus.PACKED,
  [DeliveryStatus.SHIPPED]: OrderStatus.SHIPPED,
  [DeliveryStatus.OUT_FOR_DELIVERY]: OrderStatus.OUT_FOR_DELIVERY,
  [DeliveryStatus.DELIVERED]: OrderStatus.DELIVERED,
  [DeliveryStatus.CANCELLED]: OrderStatus.CANCELLED,
}

// ==========================================
// ZOD VALIDATION SCHEMAS
// ==========================================

export const listDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(DeliveryStatus).optional(),
  assignedStaffId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'estimatedDelivery', 'deliveredAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>

export const updateDeliverySchema = z.object({
  courierPartner: z.string().trim().min(1).max(100).optional(),
  trackingNumber: z.string().trim().min(1).max(100).optional(),
  trackingUrl: z.string().trim().url().optional().or(z.literal('')),
  estimatedDelivery: z.coerce.date().optional(),
  deliveryNotes: z.string().trim().max(1000).optional(),
  recipientName: z.string().trim().min(1).max(150).optional(),
  recipientPhone: z.string().trim().min(7).max(20).optional(),
})

export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>

export const assignDeliverySchema = z.object({
  assignedStaffId: z.string().uuid({ message: 'Valid staff user ID is required' }),
  notes: z.string().trim().max(1000).optional(),
})

export type AssignDeliveryInput = z.infer<typeof assignDeliverySchema>

export const updateDeliveryStatusSchema = z.object({
  status: z.nativeEnum(DeliveryStatus, {
    errorMap: () => ({ message: 'Invalid delivery status provided' }),
  }),
  notes: z.string().trim().max(1000).optional(),
  trackingNumber: z.string().trim().max(100).optional(),
  courierPartner: z.string().trim().max(100).optional(),
})

export type UpdateDeliveryStatusInput = z.infer<typeof updateDeliveryStatusSchema>

// ==========================================
// DATA TRANSFER INTERFACES
// ==========================================

export interface DeliveryHistoryItem {
  id: string
  status: DeliveryStatus
  actorId: string | null
  actorEmail: string | null
  notes: string | null
  assignedToId: string | null
  metadata: any
  createdAt: Date
}

export interface DeliveryStaffSummary {
  id: string
  fullName: string
  email: string
  phone: string | null
}

export interface DeliveryOrderSummary {
  id: string
  orderNumber: string
  customerName: string
  customerEmail: string
  phone: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  total: number
  shippingAddressSnapshot: any
  itemsCount: number
}

export interface DeliveryDetailResponse {
  id: string
  orderId: string
  orderNumber: string
  status: DeliveryStatus
  courierPartner: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  estimatedDelivery: Date | null
  deliveredAt: Date | null
  deliveryNotes: string | null
  recipientName: string | null
  recipientPhone: string | null
  createdAt: Date
  updatedAt: Date
  assignedStaff: DeliveryStaffSummary | null
  order: DeliveryOrderSummary
  history: DeliveryHistoryItem[]
}

export interface DeliveryListItem {
  id: string
  orderId: string
  orderNumber: string
  customerName: string
  phone: string
  status: DeliveryStatus
  orderStatus: OrderStatus
  courierPartner: string | null
  trackingNumber: string | null
  estimatedDelivery: Date | null
  deliveredAt: Date | null
  assignedStaff: DeliveryStaffSummary | null
  createdAt: Date
  updatedAt: Date
}

export interface PaginatedDeliveriesResponse {
  deliveries: DeliveryListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface CustomerDeliveryResponse {
  orderNumber: string
  status: DeliveryStatus
  courierPartner: string | null
  trackingNumber: string | null
  trackingUrl: string | null
  estimatedDelivery: Date | null
  deliveredAt: Date | null
  deliveryNotes: string | null
  recipientName: string | null
  recipientPhone: string | null
  shippingAddress: any
  updatedAt: Date
  history: {
    status: DeliveryStatus
    notes: string | null
    createdAt: Date
  }[]
}
