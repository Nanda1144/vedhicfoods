import { z } from 'zod'
import { InventoryStatus } from '@prisma/client'

export const addToCartSchema = z.object({
  productId: z.string().trim().min(1, 'Product ID or slug is required'),
  quantity: z.coerce.number().int('Quantity must be an integer').min(1, 'Quantity must be at least 1').max(100, 'Cannot exceed 100 items per line').default(1),
  // Any client-provided price/discount/totals will be ignored/stripped by Zod parse
})

export const updateCartItemSchema = z.object({
  quantity: z.coerce.number().int('Quantity must be an integer').min(0, 'Quantity cannot be negative').max(100, 'Cannot exceed 100 items per line'),
})

export interface CartItemResponse {
  id: string
  productId: string
  productName: string
  slug: string
  sku: string
  unit: string
  image: string
  unitPrice: number
  mrp: number
  discount: number
  quantity: number
  lineTotal: number
  lineSavings: number
  priceSnapshot: number
  priceChanged: boolean
  inventory: {
    availableQuantity: number
    status: InventoryStatus
    isOutOfStock: boolean
    hasInsufficientStock: boolean
    isAvailable: boolean
  }
}

export interface CartResponse {
  cartId: string
  userId: string | null
  sessionToken: string | null
  items: CartItemResponse[]
  itemCount: number
  totalUnits: number
  subtotal: number
  originalSubtotal: number
  savings: number
  shipping: number
  tax: number
  total: number
  currency: string
  hasStockIssues: boolean
  updatedAt: string
}
