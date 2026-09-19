import type { ID, SortDirection } from './common'

export interface NutritionFact {
  label: string
  value: string
  /** Optional % of daily value for the progress bar visualisation. */
  percent?: number
}

export interface ProductSpecification {
  label: string
  value: string
}

export interface Category {
  id: ID
  slug: string
  name: string
  tagline: string
  description: string
  image: string
  accent: string
  featured: boolean
  sortOrder: number
}

export interface Product {
  id: ID
  slug: string
  name: string
  categorySlug: string
  shortDescription: string
  description: string
  /** Selling price in the smallest currency unit avoided — plain INR value. */
  price: number
  /** Maximum retail price / original price for discount display. */
  mrp: number
  currency: 'INR'
  /** Human-readable pack size, e.g. "250 g". */
  unit: string
  netWeight: number
  images: string[]
  tags: string[]
  rating: number
  reviewCount: number
  stock: number
  sku: string
  ingredients: string[]
  allergens: string[]
  shelfLife: string
  storage: string
  nutrition: NutritionFact[]
  specifications: ProductSpecification[]
  isOrganic: boolean
  isBestSeller: boolean
  isNew: boolean
  isFeatured: boolean
  /** Admin availability toggle. Missing = active (seeded products). */
  active?: boolean
  /** Unit count at or below which the product is flagged "low stock". */
  lowStockThreshold?: number
  createdAt: string
}

export interface ProductBadge {
  label: string
  tone: 'primary' | 'secondary' | 'accent' | 'danger' | 'success'
}

export type ProductSortKey =
  | 'featured'
  | 'bestsellers'
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'rating'
  | 'name-asc'

export interface ProductFilters {
  query: string
  categories: string[]
  tags: string[]
  minPrice: number | null
  maxPrice: number | null
  inStockOnly: boolean
  organicOnly: boolean
  minRating: number
  sort: ProductSortKey
  direction: SortDirection
}

export const DEFAULT_PRODUCT_FILTERS: ProductFilters = {
  query: '',
  categories: [],
  tags: [],
  minPrice: null,
  maxPrice: null,
  inStockOnly: false,
  organicOnly: false,
  minRating: 0,
  sort: 'featured',
  direction: 'desc',
}

export interface Review {
  id: ID
  productId: ID
  customerName: string
  rating: number
  title: string
  body: string
  createdAt: string
  verified: boolean
}

export interface Testimonial {
  id: ID
  name: string
  location: string
  quote: string
  rating: number
  avatarInitials: string
  /** Product the customer purchased (shown in the editorial layout). */
  product?: string
}

export interface FaqItem {
  id: ID
  question: string
  answer: string
  category: string
}
