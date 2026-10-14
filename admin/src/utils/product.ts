import type { Product, ProductBadge } from '@/types'

/**
 * Derives the badge set shown on a product card. Kept out of the UI layer so
 * the business logic (which badge wins) can change without touching components.
 */
export function badgesFor(product: Product): ProductBadge[] {
  const badges: ProductBadge[] = []
  if (!product.isNew && product.isBestSeller) {
    badges.push({ label: 'Bestseller', tone: 'secondary' })
  }
  if (product.isNew) {
    badges.push({ label: 'New arrival', tone: 'accent' })
  }
  if (product.stock === 0) {
    badges.push({ label: 'Out of stock', tone: 'danger' })
  } else if (product.stock <= 15) {
    badges.push({ label: 'Low stock', tone: 'danger' })
  }
  if (badges.length === 0 && product.isOrganic) {
    badges.push({ label: 'Organic', tone: 'success' })
  }
  return badges.slice(0, 2)
}

export type StockStatus = 'in-stock' | 'low' | 'out'

export function stockStatus(stock: number): StockStatus {
  if (stock <= 0) return 'out'
  if (stock <= 15) return 'low'
  return 'in-stock'
}

export function stockLabel(stock: number): string {
  if (stock <= 0) return 'Currently out of stock'
  if (stock <= 15) return `Only ${stock} left in stock`
  return `In stock · ${stock} available`
}