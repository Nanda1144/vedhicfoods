import { formatCurrency, discountPercent } from '@/utils/format'
import { cn } from '@/utils/cn'

interface PriceDisplayProps {
  price: number
  mrp?: number
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'inverse'
  className?: string
}

export function PriceDisplay({
  price,
  mrp,
  size = 'md',
  variant = 'default',
  className,
}: PriceDisplayProps) {
  const off = mrp ? discountPercent(mrp, price) : 0
  return (
    <span className={cn('price', `price--${size}`, `price--${variant}`, className)}>
      <span className="price__now">{formatCurrency(price)}</span>
      {mrp && mrp > price && (
        <>
          <span className="price__was">{formatCurrency(mrp)}</span>
          <span className="price__off">{off}% off</span>
        </>
      )}
    </span>
  )
}