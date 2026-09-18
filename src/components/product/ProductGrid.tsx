import type { Product } from '@/types'
import { ProductCard } from './ProductCard'

interface ProductGridProps {
  products: Product[]
  priorityThrough?: number
  className?: string
}

export function ProductGrid({ products, priorityThrough = 2, className }: ProductGridProps) {
  if (products.length === 0) return null

  return (
    <div className={`product-grid ${className ?? ''}`.trim()}>
      {products.map((product, index) => (
        <ProductCard key={product.id} product={product} priority={index < priorityThrough} />
      ))}
    </div>
  )
}