
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1440,
} as const

export const PRODUCT_GRID_PAGE_SIZES = [9, 12, 24] as const
export const PRODUCT_GRID_DEFAULT_PAGE_SIZE = 12 as const

export const RATING_OPTIONS = [
  { label: 'Any rating', value: '0' },
  { label: '4.5 ★ & above', value: '4.5' },
  { label: '4 ★ & above', value: '4' },
  { label: '3 ★ & above', value: '3' },
] as const

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

/** How many skeleton tiles to show while a grid is loading. */
export const SKELETON_TILES = 8 as const