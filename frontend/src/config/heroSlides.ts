/**
 * Centralised cinematic hero-slide configuration.
 *
 * The homepage hero tells the brand journey in a fixed order — this file is the
 * single source of truth for that order, and the only place that maps a slide to
 * its desktop/mobile image.
 *
 * Image resolution
 * ----------------
 * Images live in the repo-root `assests/` folder (as named by the team, alias
 * `@assets`). They are discovered with Vite's `import.meta.glob`, then matched to
 * a slide by a normalised filename stem, so renames like `customers.png` vs
 * `customer.png` or the `ingredents.jpg` typo keep working without code changes.
 *
 *   - wide screens (>= 768px) read `assests/desktop/`
 *   - narrow screens (< 768px) read `assests/mobile/`
 *   - a mobile image that does not exist yet falls back to the desktop image for
 *     the SAME slide (never an unrelated image).
 *
 * The order below is explicit and must never be alphabetically sorted.
 */

export const HERO_FIXED_HEADING = 'The Art of Pure'

export const HERO_SUBTITLE = "From Nature's Goodness to Your Family's Table"

export type HeroSlide = {
  /** Stable identifier used as a React key and for telemetry. */
  id: string
  /** The final word of the heading, typed letter-by-letter per slide. */
  word: string
  /** Accessible description of the background photograph. */
  description: string
  /** Wide-screen image URL. */
  desktop: string
  /** Narrow-screen image URL (falls back to `desktop` when absent). */
  mobile: string
  /** Optional focal point, e.g. `center 40%`. */
  focalDesktop?: string
  focalMobile?: string
}

/** Maps a wide-screen variant of a slide to its filename stem. */
const DESKTOP_IMAGES = import.meta.glob<string>('@assets/desktop/**/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  import: 'default',
})

/** Maps a narrow-screen variant of a slide to its filename stem. */
const MOBILE_IMAGES = import.meta.glob<string>('@assets/mobile/**/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  import: 'default',
})

/** Images dropped directly in `assests/` are treated as a desktop fallback. */
const ROOT_IMAGES = import.meta.glob<string>('@assets/*.{jpg,jpeg,png,webp,avif}', {
  eager: true,
  import: 'default',
})

/**
 * Filename-stem aliases. Keys are normalised stems (lowercase, letters only);
 * values are the slide id they belong to. Extend this when the client renames
 * files.
 */
const STEM_TO_SLIDE: Record<string, string> = {
  ingredient: 'ingredients',
  ingredients: 'ingredients',
  ingredent: 'ingredients',
  ingredents: 'ingredients',
  cooking: 'cooking',
  prep: 'cooking',
  arranging: 'arranging',
  arrange: 'arranging',
  platter: 'arranging',
  presentation: 'arranging',
  customer: 'customer',
  customers: 'customer',
  happiness: 'customer',
  packing: 'packing',
  packaging: 'packing',
  pack: 'packing',
  delivery: 'delivery',
  deliver: 'delivery',
  kitchen: 'kitchen',
  tradition: 'kitchen',
}

function slideIdOf(path: string): string | undefined {
  const base = path.split('/').pop() ?? path
  const stem = base
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
  return STEM_TO_SLIDE[stem]
}

function findImage(dir: Record<string, string>, slideId: string): string | undefined {
  for (const [path, url] of Object.entries(dir)) {
    if (slideIdOf(path) === slideId) return url
  }
  return undefined
}

/** The exact on-screen order of the brand journey. Do not reorder. */
const SLIDE_DEFS: ReadonlyArray<{
  id: string
  word: string
  description: string
  focalDesktop?: string
  focalMobile?: string
}> = [
  {
    id: 'ingredients',
    word: 'Ingredients',
    description: 'Organic millet, grain and jaggery laid out on a wooden counter.',
  },
  {
    id: 'cooking',
    word: 'Cooking',
    description: 'Small-batch cooking over a slow flame in the Vedhic kitchen.',
  },
  {
    id: 'arranging',
    word: 'Presentation',
    description: 'Hand-arranged batch plated and ready to serve.',
  },
  {
    id: 'customer',
    word: 'Happiness',
    description: 'A customer enjoying Vedhic millet laddus at home.',
  },
  {
    id: 'packing',
    word: 'Packaging',
    description: 'Packs being sealed, labelled and boxed by hand.',
  },
  {
    id: 'delivery',
    word: 'Delivery',
    description: 'A dispatch rider carrying Vedhic parcels to customers.',
  },
  {
    id: 'kitchen',
    word: 'Tradition',
    description: 'The traditional Vedhic kitchen where every recipe begins.',
  },
]

/** Slides missing an image are dropped so no slide can render an empty layer. */
export const HERO_SLIDES: HeroSlide[] = SLIDE_DEFS.flatMap((def) => {
  const desktop = findImage(DESKTOP_IMAGES, def.id) ?? findImage(ROOT_IMAGES, def.id)
  if (!desktop) {
    if (import.meta.env.DEV) {
      console.warn(
        `[heroSlides] No desktop image found for slide "${def.id}" in assests/desktop/. ` +
          'Expected a file whose name contains that word (e.g. assests/desktop/' + def.id + '.webp).',
      )
    }
    return []
  }
  const mobile = findImage(MOBILE_IMAGES, def.id) ?? desktop
  if (import.meta.env.DEV && mobile === desktop && !findImage(MOBILE_IMAGES, def.id)) {
    console.warn(
      `[heroSlides] No mobile image for slide "${def.id}"; falling back to the desktop image. ` +
        'Add it under assests/mobile/ to use a dedicated crop.',
    )
  }
  return [
    {
      id: def.id,
      word: def.word,
      description: def.description,
      desktop,
      mobile,
      focalDesktop: def.focalDesktop,
      focalMobile: def.focalMobile,
    },
  ]
})

/**
 * Optional `VITE_HERO_IMAGES` override (comma-separated URLs or `/public` paths).
 * Documented in `frontend/.env.example`; takes precedence over the `assests/`
 * folder when the admin console has published no hero images.
 */
const ENV_OVERRIDE = ((import.meta.env.VITE_HERO_IMAGES as string | undefined) ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

/**
 * Slides to actually render.
 *
 * Resolution order:
 *   1. Admin-published `website_hero_images` (paired with the fixed words in order)
 *   2. `VITE_HERO_IMAGES` env override (same pairing)
 *   3. The build-time `assests/` brand journey
 */
export function heroSlidesFor(adminImages?: readonly string[]): HeroSlide[] {
  const override = adminImages?.length ? adminImages : ENV_OVERRIDE
  if (!override.length || HERO_SLIDES.length === 0) return HERO_SLIDES
  return override.map((src, index) => {
    const base = HERO_SLIDES[index % HERO_SLIDES.length]!
    return {
      ...base,
      id: `${base.id}-${index}`,
      desktop: src,
      mobile: src,
      focalDesktop: undefined,
      focalMobile: undefined,
    }
  })
}
