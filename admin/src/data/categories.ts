import type { Category } from '@/types'
import { placeholderImage } from '@/utils/placeholder'

/** Category imagery is generated locally (copyright-free) for the prototype. */
function image(slug: string, variant: 'laddu' | 'roti' | 'grain' | 'jar' | 'generic') {
  return placeholderImage({ seed: `category-${slug}`, variant, width: 720, height: 900 })
}

export const CATEGORIES: Category[] = [
  {
    id: 'cat-millet-laddus',
    slug: 'millet-laddus',
    name: 'Millet Laddus',
    tagline: 'Slow-roasted, hand-rolled',
    description:
      'Stone-ground millets roasted in small batches and bound with jaggery and cold-pressed ghee. No refined sugar, no preservatives.',
    image: image('millet-laddus', 'laddu'),
    accent: '#C9A24B',
    featured: true,
    sortOrder: 1,
  },
  {
    id: 'cat-ragi-specials',
    slug: 'ragi-specials',
    name: 'Ragi Specials',
    tagline: 'Calcium-dense heritage ragi',
    description:
      'Finger millet from rain-fed Karnataka farms — high in calcium and iron, milled fresh and crafted into traditional favourites.',
    image: image('ragi-specials', 'laddu'),
    accent: '#6B4A2F',
    featured: true,
    sortOrder: 2,
  },
  {
    id: 'cat-traditional-rotis',
    slug: 'traditional-rotis',
    name: 'Traditional Rotis',
    tagline: 'Griddle-fresh, ready in minutes',
    description:
      'Hand-pressed rotis made the way they have been for generations — ragi, jowar, bajra and multigrain, with zero maida.',
    image: image('traditional-rotis', 'roti'),
    accent: '#B28F3C',
    featured: true,
    sortOrder: 3,
  },
  {
    id: 'cat-organic-millets',
    slug: 'organic-millets',
    name: 'Organic Millets',
    tagline: 'Unpolished & single-origin',
    description:
      'Foxtail, kodo, barnyard, little and proso millet — cleaned, de-stoned and packed within days of milling.',
    image: image('organic-millets', 'grain'),
    accent: '#6B7B3A',
    featured: true,
    sortOrder: 4,
  },
  {
    id: 'cat-heritage-grains',
    slug: 'heritage-grains',
    name: 'Heritage Grains',
    tagline: 'Native seeds, traceable farms',
    description:
      'Heirloom rice, native wheat, red rice and unpolished dals grown from saved seed lines by partner organic farms.',
    image: image('heritage-grains', 'grain'),
    accent: '#5C3F28',
    featured: false,
    sortOrder: 5,
  },
  {
    id: 'cat-ready-to-eat',
    slug: 'ready-to-eat',
    name: 'Ready to Eat',
    tagline: 'Traditional meals, no fuss',
    description:
      'Ghee-roasted malts, millet upma mixes and wholesome breakfast blends that come together in under five minutes.',
    image: image('ready-to-eat', 'jar'),
    accent: '#9C7A2E',
    featured: true,
    sortOrder: 6,
  },
  {
    id: 'cat-healthy-snacks',
    slug: 'healthy-snacks',
    name: 'Healthy Snacks',
    tagline: 'Guilt-free everyday bites',
    description:
      'Millet cookies, ragi bites, seed chikkis and dry-fruit energy bars sweetened only with jaggery and dates.',
    image: image('healthy-snacks', 'generic'),
    accent: '#7C8C4A',
    featured: false,
    sortOrder: 7,
  },
]

export const CATEGORY_BY_SLUG: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((category) => [category.slug, category]),
)
