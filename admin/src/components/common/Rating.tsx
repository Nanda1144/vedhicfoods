import { cn } from '@/utils/cn'
import { Icon } from './Icon'

interface RatingProps {
  value: number
  count?: number
  size?: 'sm' | 'md' | 'lg'
  showValue?: boolean
  className?: string
}

const STAR_SIZE = { sm: 13, md: 15, lg: 18 } as const

export function Rating({
  value,
  count,
  size = 'md',
  showValue = true,
  className,
}: RatingProps) {
  const starSize = STAR_SIZE[size]
  const percent = Math.max(0, Math.min(100, (value / 5) * 100))

  return (
    <span className={cn('rating', `rating--${size}`, className)} role="img" aria-label={`Rated ${value} out of 5${count ? ` · ${count} reviews` : ''}`}>
      <span className="rating__track" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Icon key={i} name="star" size={starSize} />
        ))}
        <span className="rating__fill" style={{ width: `${percent}%` }} aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Icon key={i} name="star" size={starSize} />
          ))}
        </span>
      </span>
      {showValue && <span className="rating__value">{value.toFixed(1)}</span>}
      {count !== undefined && <span className="rating__count">({count})</span>}
    </span>
  )
}