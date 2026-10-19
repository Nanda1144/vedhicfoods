
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1440,
} as const

export const PRODUCT_GRID_DEFAULT_PAGE_SIZE = 12 as const

export const SORT_OPTIONS = [
  { label: 'Featured', value: 'featured' },
  { label: 'Best sellers', value: 'bestsellers' },
  { label: 'New arrivals', value: 'newest' },
  { label: 'Price: Low to High', value: 'price-asc' },
  { label: 'Price: High to Low', value: 'price-desc' },
  { label: 'Top Rated', value: 'rating' },
  { label: 'Name: A to Z', value: 'name-asc' },
] as const

export const TOAST_DURATIONS = {
  short: 2600,
  normal: 4200,
  long: 7000,
} as const