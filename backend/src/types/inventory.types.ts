import { z } from 'zod'
import { InventoryStatus } from '@prisma/client'

// ==========================================
// 1. INVENTORY OPERATIONS
// ==========================================

export const INVENTORY_OPERATIONS = [
  'ADD_STOCK',
  'REMOVE_STOCK',
  'RESERVE_STOCK',
  'RELEASE_RESERVATION',
  'CONFIRM_DEDUCTION',
  'RESTOCK',
  'MANUAL_ADJUSTMENT',
] as const

export type InventoryOperation = (typeof INVENTORY_OPERATIONS)[number]

// ==========================================
// 2. AUDIT ACTION CONSTANTS
// ==========================================

export const INVENTORY_AUDIT_ACTIONS = {
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  STOCK_RESERVED: 'STOCK_RESERVED',
  STOCK_RELEASED: 'STOCK_RELEASED',
  STOCK_DEDUCTED: 'STOCK_DEDUCTED',
  STOCK_RESTOCKED: 'STOCK_RESTOCKED',
} as const

// ==========================================
// 3. ZOD VALIDATION SCHEMAS
// ==========================================

// PostgreSQL stores these columns as 4-byte signed integers. A quantity larger
// than this fits in the Zod number but overflows on the write, surfacing as an
// opaque 500 instead of a validation error — so it is bounded here.
export const MAX_INVENTORY_QUANTITY = 2_147_483_647

export const adjustStockSchema = z.object({
  operation: z.enum(INVENTORY_OPERATIONS, {
    errorMap: () => ({
      message: `Operation must be one of: ${INVENTORY_OPERATIONS.join(', ')}`,
    }),
  }),
  quantity: z.coerce
    .number()
    .int()
    .positive('Adjustment quantity must be a positive integer')
    .max(MAX_INVENTORY_QUANTITY, 'Adjustment quantity exceeds the maximum supported value'),
  reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
  reorderThreshold: z.coerce
    .number()
    .int()
    .min(0, 'Reorder threshold cannot be negative')
    .max(MAX_INVENTORY_QUANTITY, 'Reorder threshold exceeds the maximum supported value')
    .optional(),
})

export const updateInventorySchema = z.object({
  reorderThreshold: z.coerce
    .number()
    .int()
    .min(0, 'Reorder threshold cannot be negative')
    .max(MAX_INVENTORY_QUANTITY, 'Reorder threshold exceeds the maximum supported value')
    .optional(),
  status: z.nativeEnum(InventoryStatus, {
    errorMap: () => ({
      message: 'Status must be IN_STOCK, LOW_STOCK, OUT_OF_STOCK, or BACKORDER',
    }),
  }).optional(),
  notes: z.string().trim().max(500, 'Notes cannot exceed 500 characters').optional(),
})

export const inventoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  status: z.union([z.nativeEnum(InventoryStatus), z.literal('ALL')]).optional(),
  lowStockOnly: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean()).optional(),
  low_stock: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean()).optional(),
  categoryId: z.string().optional(),
  sort: z.string().optional(),
})

export const reservationItemSchema = z.object({
  productId: z.string().min(1, 'Product identifier (ID or slug) is required'),
  quantity: z.coerce.number().int().positive('Quantity must be greater than zero'),
})

export const stockReservationSchema = z.object({
  items: z.array(reservationItemSchema).min(1, 'At least one item is required for reservation'),
  orderId: z.string().optional(),
  orderNumber: z.string().optional(),
  reason: z.string().optional(),
})

// ==========================================
// 4. INFERRED TYPES
// ==========================================

export type AdjustStockInput = z.infer<typeof adjustStockSchema>
export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>
export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>
export type ReservationItem = z.infer<typeof reservationItemSchema>
export type StockReservationInput = z.infer<typeof stockReservationSchema>

// ==========================================
// 5. RESPONSE DATA CONTRACTS
// ==========================================

export interface FormattedInventory {
  id: string
  productId: string
  sku: string
  productName: string
  slug: string
  categoryName?: string | null
  price: number
  availableQuantity: number
  reservedQuantity: number
  totalStock: number
  soldQuantity: number
  reorderThreshold: number
  status: InventoryStatus
  isLowStock: boolean
  isOutOfStock: boolean
  updatedAt: string
  product?: {
    id: string
    name: string
    slug: string
    sku: string
    price: number
    stock: number
    isActive: boolean
    status: string
    primaryImage?: string
  }
}

export interface FormattedInventoryLog {
  id: string
  inventoryId: string
  productId: string
  productName?: string
  sku?: string
  actorId: string | null
  actorEmail: string | null
  operation: string
  previousQuantity: number
  newQuantity: number
  quantityChange: number
  previousReserved: number
  newReserved: number
  reason: string | null
  orderId: string | null
  metadata: Record<string, any>
  createdAt: string
}
