import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { STORAGE_KEYS } from '@/config/site'
import { computeCartTotals, mergeCartItems, productToCartItem } from '@/utils/cart'
import { storage } from '@/utils/storage'
import { evaluateCoupon } from '@/services/couponService'
import type { AppliedCoupon, CartItem, CartTotals, CouponValidation, Product } from '@/types'
import { useToast } from './ToastContext'

interface CartContextValue {
  items: CartItem[]
  totals: CartTotals
  count: number
  isOpen: boolean
  coupon: AppliedCoupon | null
  open: () => void
  close: () => void
  add: (product: Product, quantity?: number, silent?: boolean) => void
  updateQuantity: (id: string, quantity: number) => void
  remove: (id: string) => void
  clear: () => void
  applyCoupon: (code: string) => Promise<CouponValidation>
  removeCoupon: () => void
  hydrated: boolean
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { push } = useToast()
  const [items, setItems] = useState<CartItem[]>(() =>
    storage.get<CartItem[]>(STORAGE_KEYS.cart, []),
  )
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(() =>
    storage.get<AppliedCoupon | null>(STORAGE_KEYS.coupon, null),
  )
  const [hydrated] = useState(() => typeof window !== 'undefined')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    storage.set(STORAGE_KEYS.cart, items)
  }, [items])

  useEffect(() => {
    if (coupon) storage.set(STORAGE_KEYS.coupon, coupon)
    else storage.remove(STORAGE_KEYS.coupon)
  }, [coupon])

  const totals = useMemo(() => computeCartTotals(items, coupon), [items, coupon])
  const count = totals.itemCount

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const add = useCallback(
    (product: Product, quantity = 1, silent = false) => {
      const line = productToCartItem(product, quantity)
      if (line.quantity === 0) {
        if (!silent) {
          push({
            title: 'Out of stock',
            description: `${product.name} is currently unavailable.`,
            tone: 'danger',
          })
        }
        return
      }
      setItems((current) => mergeCartItems(current, [line]))
      setIsOpen(true)
      if (!silent) {
        push({
          title: 'Added to your basket',
          description: `${product.name} · ${line.quantity} × ₹${product.price}`,
        })
      }
    },
    [push],
  )

  const updateQuantity = useCallback((id: string, quantity: number) => {
    setItems((current) =>
      current
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, Math.min(quantity, item.stock, 99)) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const clear = useCallback(() => {
    setItems([])
    setCoupon(null)
  }, [])

  const applyCoupon = useCallback(
    async (code: string): Promise<CouponValidation> => {
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
      const result = evaluateCoupon(code, subtotal)
      if (result.valid && result.coupon) setCoupon(result.coupon)
      return result
    },
    [items],
  )

  const removeCoupon = useCallback(() => setCoupon(null), [])

  const value = useMemo(
    () => ({
      items,
      totals,
      count,
      isOpen,
      coupon,
      open,
      close,
      add,
      updateQuantity,
      remove,
      clear,
      applyCoupon,
      removeCoupon,
      hydrated,
    }),
    [
      items,
      totals,
      count,
      isOpen,
      coupon,
      open,
      close,
      add,
      updateQuantity,
      remove,
      clear,
      applyCoupon,
      removeCoupon,
      hydrated,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) throw new Error('useCart must be used within a CartProvider')
  return context
}