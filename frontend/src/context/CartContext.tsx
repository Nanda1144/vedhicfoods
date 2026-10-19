import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { STORAGE_KEYS } from '@/config/site'
import { computeCartTotals, mergeCartItems, productToCartItem } from '@/utils/cart'
import { storage } from '@/utils/storage'
import { cartService, type ServerCart, type ServerCartItem } from '@/services/cartService'
import { couponService } from '@/services/couponService'
import type { AppliedCoupon, CartItem, CartTotals, CouponValidation, Product } from '@/types'
import { useToast } from './useToast'
import { useAuth } from './useAuth'
import { CartContext } from './useCart'

function toCartItem(item: ServerCartItem): CartItem {
  return {
    id: item.id,
    productId: item.productId,
    slug: item.slug,
    name: item.productName,
    image: item.image,
    price: item.unitPrice,
    mrp: item.mrp,
    unit: item.unit,
    quantity: item.quantity,
    stock: item.inventory.availableQuantity,
    isOutOfStock: item.inventory.isOutOfStock,
    hasInsufficientStock: item.inventory.hasInsufficientStock,
    availableQuantity: item.inventory.availableQuantity,
    priceChanged: item.priceChanged,
  }
}

function toCartItems(cart: ServerCart | null): CartItem[] {
  return cart?.items?.map(toCartItem) ?? []
}

function totalsFromServer(cart: ServerCart, coupon: AppliedCoupon | null): CartTotals {
  const discount = Math.min(coupon?.amount ?? 0, cart.subtotal)
  return {
    subtotal: cart.subtotal,
    savings: cart.savings,
    shipping: cart.shipping,
    tax: cart.tax,
    discount,
    total: Math.max(0, cart.total - discount),
    itemCount: cart.totalUnits,
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { push } = useToast()
  const { user } = useAuth()

  const [serverCart, setServerCart] = useState<ServerCart | null>(null)
  const [localItems, setLocalItems] = useState<CartItem[] | null>(null)
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(() =>
    storage.get<AppliedCoupon | null>(STORAGE_KEYS.coupon, null),
  )
  const [hydrated, setHydrated] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  /** Items rendered = optimistic overlay while a mutation is in flight. */
  const items = localItems ?? toCartItems(serverCart)
  const totals = useMemo(
    () => (serverCart ? totalsFromServer(serverCart, coupon) : computeCartTotals(items, coupon)),
    [serverCart, coupon, items],
  )
  const count = serverCart ? serverCart.totalUnits : totals.itemCount
  const hasStockIssues = serverCart?.hasStockIssues ?? false

  useEffect(() => {
    if (coupon) storage.set(STORAGE_KEYS.coupon, coupon)
    else storage.remove(STORAGE_KEYS.coupon)
  }, [coupon])

  // Re-validate a persisted coupon against the live server cart. The amount is
  // server-authoritative but is also mirrored to localStorage and subtracted
  // client-side, so a tampered or stale value would otherwise drive the
  // displayed payable total. Replace it with the server quote / drop it.
  useEffect(() => {
    if (!serverCart || !coupon) return
    const lines = serverCart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }))
    if (lines.length === 0) return

    let cancelled = false
    const persistedAmount = coupon.amount
    void couponService
      .validate(coupon.code, lines)
      .then((result) => {
        if (cancelled) return
        if (!result.valid) {
          setCoupon(null)
          return
        }
        if (result.coupon && result.coupon.amount !== persistedAmount) {
          setCoupon(result.coupon)
        }
      })
      .catch(() => {
        /* keep the persisted coupon; the next cart change retries */
      })
    return () => {
      cancelled = true
    }
  }, [serverCart, coupon])

  const applyServer = useCallback((cart: ServerCart) => {
    setServerCart(cart)
    setLocalItems(null)
    setHydrated(true)
  }, [])

  const reconcile = useCallback(async () => {
    try {
      const fresh = await cartService.get()
      applyServer(fresh)
    } catch {
      /* offline — keep the optimistic state; the next action retries */
    }
  }, [applyServer])

  const runMutation = useCallback(
    async (mutate: () => Promise<ServerCart>, onError?: () => void) => {
      setSyncing(true)
      try {
        applyServer(await mutate())
      } catch {
        onError?.()
        // Re-fetch so optimistic updates never outlive the failed request.
        await reconcile()
      } finally {
        setSyncing(false)
      }
    },
    [applyServer, reconcile],
  )

  const add = useCallback(
    async (product: Product, quantity = 1, silent = false) => {
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
      setLocalItems((current) => mergeCartItems(current ?? toCartItems(serverCart), [line]))
      setIsOpen(true)
      if (!silent) {
        push({
          title: 'Added to your basket',
          description: `${product.name} · ${line.quantity} × ₹${product.price}`,
        })
      }
      await runMutation(() => cartService.add(product.id, line.quantity))
    },
    [push, runMutation, serverCart],
  )

  const updateQuantity = useCallback(
    async (id: string, quantity: number) => {
      const current = toCartItems(serverCart)
      setLocalItems((existing) =>
        (existing ?? current)
          .map((item) =>
            item.id === id
              ? { ...item, quantity: Math.max(0, Math.min(quantity, item.stock, 100)) }
              : item,
          )
          .filter((item) => item.quantity > 0),
      )
      await runMutation(() => cartService.update(id, Math.max(0, Math.min(quantity, 100))))
    },
    [runMutation, serverCart],
  )

  const remove = useCallback(
    async (id: string) => {
      setLocalItems((existing) => (existing ?? toCartItems(serverCart)).filter((item) => item.id !== id))
      await runMutation(() => cartService.remove(id))
    },
    [runMutation, serverCart],
  )

  const clear = useCallback(async () => {
    setLocalItems([])
    setCoupon(null)
    await runMutation(() => cartService.clear())
  }, [runMutation])

  const applyCoupon = useCallback(
    async (code: string): Promise<CouponValidation> => {
      const lines = (localItems ?? toCartItems(serverCart)).map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      }))
      const result = await couponService.validate(code, lines)
      if (result.valid && result.coupon) setCoupon(result.coupon)
      return result
    },
    [localItems, serverCart],
  )

  const removeCoupon = useCallback(() => setCoupon(null), [])

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  // Initial hydration — fetch (or create) the server cart for this identity.
  useEffect(() => {
    let cancelled = false
    void cartService
      .get()
      .then((cart) => {
        if (!cancelled) applyServer(cart)
      })
      .catch(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [applyServer])

  // Identity change: fold the guest basket into the account on sign-in, and
  // switch to the freshly-created guest identity on sign-out.
  const previousUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const nextUserId = user?.id ?? null
    if (previousUserId.current === nextUserId) return
    previousUserId.current = nextUserId

    if (nextUserId) {
      cartService
        .merge()
        .then(applyServer)
        .catch(() => cartService.get().then(applyServer).catch(() => undefined))
    } else {
      cartService.get().then(applyServer).catch(() => undefined)
    }
  }, [user?.id, applyServer])

  const value = useMemo(
    () => ({
      items,
      totals,
      count,
      isOpen,
      coupon,
      hydrated,
      syncing,
      hasStockIssues,
      open,
      close,
      add,
      updateQuantity,
      remove,
      clear,
      applyCoupon,
      removeCoupon,
    }),
    [
      items,
      totals,
      count,
      isOpen,
      coupon,
      hydrated,
      syncing,
      hasStockIssues,
      open,
      close,
      add,
      updateQuantity,
      remove,
      clear,
      applyCoupon,
      removeCoupon,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}