import { Link } from 'react-router-dom'
import type { Category } from '@/types'
import { SmartImage, Icon } from '../common'

interface CategoryCardProps {
  category: Category
  featured?: boolean
}

export function CategoryCard({ category, featured = false }: CategoryCardProps) {
  return (
    <Link
      to={`/shop?category=${category.slug}`}
      className={`category-card ${featured ? 'category-card--featured' : ''}`.trim()}
      style={{ '--cat-accent': category.accent } as React.CSSProperties}
    >
      <SmartImage
        src={category.image}
        alt={category.name}
        aspect={featured ? 'portrait' : 'square'}
        ratio={featured ? '4 / 5' : '1 / 1'}
        seed={`category-${category.slug}`}
        className="category-card__image"
      />
      <span className="category-card__scrim" aria-hidden="true" />
      <span className="category-card__body">
        <span className="category-card__tagline">{category.tagline}</span>
        <span className="category-card__name">{category.name}</span>
        <span className="category-card__cta">
          Explore <Icon name="arrow-right" size={15} />
        </span>
      </span>
    </Link>
  )
}