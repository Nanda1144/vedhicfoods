import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export function Skeleton({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('skeleton', className)} style={style} aria-hidden="true" {...props} />
  )
}

interface SkeletonProductCardProps {
  aspect?: string
}

export function SkeletonProductCard({ aspect = '4 / 5' }: SkeletonProductCardProps) {
  return (
    <div className="product-card product-card--skeleton">
      <div className="product-card__media" style={{ aspectRatio: aspect }}>
        <Skeleton className="product-card__media-skeleton" />
      </div>
      <div className="product-card__body">
        <Skeleton style={{ width: '38%', height: 14 }} />
        <Skeleton style={{ width: '88%', height: 18, marginTop: 10 }} />
        <Skeleton style={{ width: '64%', height: 16, marginTop: 8 }} />
        <div className="row row--between" style={{ marginTop: 16 }}>
          <Skeleton style={{ width: '42%', height: 20 }} />
          <Skeleton style={{ width: '30%', height: 36, borderRadius: 999 }} />
        </div>
      </div>
    </div>
  )
}

export interface SkeletonConfig extends CSSProperties {}

/** Grid of skeleton cards for product/listing loading states. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonProductCard key={i} />
      ))}
    </div>
  )
}