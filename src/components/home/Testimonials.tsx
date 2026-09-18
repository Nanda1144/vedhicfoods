import type { Testimonial } from '@/types'
import { Rating, Icon, Skeleton } from '../common'
import { cn } from '@/utils/cn'

interface TestimonialsProps {
  items: Testimonial[]
  loading?: boolean
  className?: string
}

export function Testimonials({ items, loading = false, className }: TestimonialsProps) {
  if (loading) {
    return (
      <div className={cn('testimonials testimonial-grid', className)}>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="testimonial-card">
            <Skeleton style={{ width: '40%', height: 14 }} />
            <Skeleton style={{ width: '100%', height: 64, marginTop: 12 }} />
            <Skeleton style={{ width: '55%', height: 14, marginTop: 14 }} />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) return null

  return (
    <div className={cn('testimonials testimonial-grid', className)}>
      {items.map((item) => (
        <figure key={item.id} className="testimonial-card">
          <Rating value={item.rating} size="sm" />
          <blockquote className="testimonial-card__quote">“{item.quote}”</blockquote>
          <figcaption className="testimonial-card__person">
            <span className="testimonial-card__avatar" aria-hidden="true">
              {item.avatarInitials}
            </span>
            <span className="testimonial-card__who">
              <strong>{item.name}</strong>
              <span>
                <Icon name="map-pin" size={12} /> {item.location}
              </span>
            </span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}