import { createContext, useContext } from 'react'
import type { AppliedCoupon, CartItem, CartTotals, CouponValidation, Product } from '@/types'

export interface CartContextValue {
  items: CartItem[]
  totals: CartTotals
  count: number
  isOpen: boolean
  coupon: AppliedCoupon | null
  /** True once the initial server cart fetch has settled. */
  hydrated: boolean
  /** True while a cart mutation is in flight. */
  syncing: boolean
  /** True when the server reports any line with a stock problem. */
  hasStockIssues: boolean
  open: () => void
  close: () => void
  add: (product: Product, quantity?: number, silent?: boolean) => Promise<void>
  updateQuantity: (id: string, quantity: number) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
  applyCoupon: (code: string) => Promise<CouponValidation>
  removeCoupon: () => void
}

export const CartContext = createContext<CartContextValue | null>(null)

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within a CartProvider')
  return context
}
