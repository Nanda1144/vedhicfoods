import { SITE } from '@/config/site'
import type { AppliedCoupon, CartItem, CartTotals, Product } from '@/types'

/** Clamps a quantity to a line's stock and a sane upper bound. */
export function clampQuantity(value: number, stock: number, max = 99): number {
  return Math.max(0, Math.min(value, stock, max))
}

/** Converts a catalogue product into a cart line. */
export function productToCartItem(product: Product, quantity = 1): CartItem {
  return {
    id: product.id,
    productId: product.id,
    slug: product.slug,
    name: product.name,
    image: product.images[0] ?? '',
    price: product.price,
    mrp: product.mrp,
    unit: product.unit,
    quantity: clampQuantity(quantity, product.stock),
    stock: product.stock,
  }
}

/**
 * Price + shipping + tax calculation, mirroring the server contract.
 * Shipping & tax are based on the pre-discount subtotal (matching the
 * admin `computeTotals`), while the coupon discount is applied on top.
 */
export function computeCartTotals(items: CartItem[], coupon: AppliedCoupon | null = null): CartTotals {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const savings = items.reduce(
    (sum, item) => sum + Math.max(0, item.mrp - item.price) * item.quantity,
    0,
  )
  const shipping = subtotal === 0 || subtotal >= SITE.freeShippingThreshold ? 0 : SITE.standardShippingFee
  const tax = Math.round(subtotal * SITE.taxRate)
  const discount = coupon ? Math.min(coupon.amount, subtotal) : 0

  return {
    subtotal,
    savings,
    shipping,
    tax,
    discount,
    total: Math.max(0, subtotal - discount) + shipping + tax,
    itemCount,
  }
}

export function mergeCartItems(existing: CartItem[], incoming: CartItem[]): CartItem[] {
  const map = new Map(existing.map((item) => [item.id, { ...item }]))
  for (const item of incoming) {
    const current = map.get(item.id)
    if (current) {
      current.quantity = clampQuantity(current.quantity + item.quantity, current.stock)
    } else {
      const quantity = clampQuantity(item.quantity, item.stock)
      if (quantity > 0) map.set(item.id, { ...item, quantity })
    }
  }
  return Array.from(map.values())
}