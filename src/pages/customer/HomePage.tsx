import { useCallback, useMemo, useState } from 'react'
import { COMPANY_MILESTONES } from '@/config/site'
import { productService } from '@/services/productService'
import { contentService, newsletterService } from '@/services/contentService'
import { couponService } from '@/services/couponService'
import { useAsync } from '@/hooks'
import { useToast, useSettings } from '@/context'
import { staggerDelay } from '@/utils/motion'
import type { Category } from '@/types'
import {
  Icon,
  ButtonLink,
  SectionHeader,
  Reveal,
} from '@/components/common'
import { CategoryCard } from '@/components/product'
import { Testimonials, ImmerseHero, ProductShowcase, ScrollRail, FaqSection, type HeroIngredient } from '@/components/home'

const MARQUEE_WORDS = [
  'Stone-ground',
  'Small-batch',
  'Certified organic',
  'Farmer-direct',
  'Zero preservatives',
  'Hand-rolled weekly',
]

const PRINCIPLES = [
  {
    n: '01',
    title: 'Pure ingredients',
    copy: 'Certified-organic grains from 40+ small farms. No preservatives, no colour, no shortcuts — ever.',
    icon: 'leaf',
    imageSlug: 'organic-millets',
  },
  {
    n: '02',
    title: 'Traditional knowledge',
    copy: 'Recipes passed down three generations, kept slow and unhurried — stone-ground, low-flame, by hand.',
    icon: 'sparkles',
    imageSlug: 'traditional-rotis',
  },
  {
    n: '03',
    title: 'Careful preparation',
    copy: 'Ghee, jaggery and patient heat instead of chemistry. Made in small weekly batches, never warehoused.',
    icon: 'clock',
    imageSlug: 'millet-laddus',
  },
  {
    n: '04',
    title: 'Premium quality',
    copy: 'Every lot traceable to a single farm and harvest season, with a lot code printed on every pack.',
    icon: 'award',
    imageSlug: 'heritage-grains',
  },
] as const

const JOURNEY = [
  {
    icon: 'leaf',
    title: 'The soil',
    copy: 'Single-origin, certified-organic farms across Karnataka, paid fairly and traced lot by lot.',
  },
  {
    icon: 'box',
    title: 'Harvest & mill',
    copy: 'Grains are cleaned, de-stoned and stone-ground within days of harvest — never warehoused.',
  },
  {
    icon: 'clock',
    title: 'Slow preparation',
    copy: 'Roasted gently over low flame and rolled by hand in small weekly batches.',
  },
  {
    icon: 'truck',
    title: 'Your table',
    copy: 'Packed fresh and dispatched within 48 hours, with the harvest story on the pack.',
  },
] as const

const MODERN_FEATURES = [
  { title: 'Ready-to-eat & ready-in-minutes', copy: 'From jaggery laddu to ghee-roasted malt — wholesome food that fits a busy day.' },
  { title: 'Effortless ordering', copy: 'Add to cart, checkout securely, done. GST invoice with every order.' },
  { title: 'Premium, airtight packaging', copy: 'Designed to keep aroma and texture intact from our kitchen to yours.' },
  { title: 'Reliably delivered', copy: 'Dispatched in 48 hours and delivered across India with live tracking.' },
] as const

function heroIngredients(categories: Category[]): HeroIngredient[] {
  const bySlug = new Map(categories.map((category) => [category.slug, category]))
  const pick = (slug: string) => bySlug.get(slug)
  const items: HeroIngredient[] = []
  const laddu = pick('millet-laddus')
  const roti = pick('traditional-rotis')
  const millet = pick('organic-millets')
  const ready = pick('ready-to-eat')
  if (laddu) items.push({ image: laddu.image, label: 'Hand-rolled laddu', sub: 'Jaggery · ghee', position: 'a' })
  if (roti) items.push({ image: roti.image, label: 'Ragi roti', sub: 'Stone-ground', position: 'b' })
  if (millet) items.push({ image: millet.image, label: 'Farm-fresh millets', sub: 'Single-origin', position: 'c' })
  if (ready) items.push({ image: ready.image, label: 'Ready in minutes', sub: 'Zero maida', position: 'd' })
  return items
}

export function HomePage() {
  const { settings } = useSettings()
  const { push } = useToast()

  const bestSellers = useAsync(() => productService.bestSellers(8), [])
  const featured = useAsync(() => productService.featured(6), [])
  const testimonials = useAsync(() => contentService.testimonials(), [])
  const categories = useAsync(() => productService.categories(), [])
  const festiveCoupons = useAsync(() => couponService.available(), [])

  const orderedCategories = useMemo(
    () => [...(categories.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories.data],
  )
  const ingredients = useMemo(() => heroIngredients(categories.data ?? []), [categories.data])
  const dishImage = useMemo(() => {
    const laddu = categories.data?.find((category) => category.slug === 'millet-laddus')
    return laddu?.image ?? categories.data?.[0]?.image ?? ''
  }, [categories.data])
  const modernImage = useMemo(
    () => categories.data?.find((category) => category.slug === 'ready-to-eat')?.image ?? '',
    [categories.data],
  )
  const storyImage = useMemo(
    () => categories.data?.find((category) => category.slug === 'heritage-grains')?.image ?? '',
    [categories.data],
  )
  const principleImages = useMemo(() => {
    const map = new Map((categories.data ?? []).map((category) => [category.slug, category.image]))
    return PRINCIPLES.map((principle) => map.get(principle.imageSlug) ?? '')
  }, [categories.data])

  const festiveCode = festiveCoupons.data?.find((coupon) => coupon.code === 'FESTIVE15')
  const festiveActive = settings.promotionActive !== false && Boolean(festiveCode)

  const handleSubscribe = useCallback(
    async (email: string) => {
      await newsletterService.subscribe(email)
      push({ title: 'Welcome to the family', description: 'Your first recipe guide is on its way.' })
    },
    [push],
  )

  return (
    <>
      <ImmerseHero announcement={settings.announcementActive ? settings.announcement : settings.tagline} dishImage={dishImage} ingredients={ingredients} />

      <MarqueeBand />

      <BrandStatement />

      <Philosophy images={principleImages} />

      <section className="section section--tinted discover-sec" id="categories">
        <div className="container">
          <SectionHeader
            eyebrow="Shop by mood"
            title="Discover your kind of goodness"
            description="Every category is made in small batches from single-origin organic grain."
            align="center"
          />
          <div className="discover">
            {orderedCategories.map((category, index) => (
              <Reveal key={category.id} delay={staggerDelay(index, 60)} className="discover__cell">
                <CategoryCard category={category} featured={index === 0} showDescription />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <IngredientJourney />

      {featured.data && featured.data.length > 0 && <ProductShowcase products={featured.data} />}

      {storyImage && <StoryTeaser image={storyImage} />}

      {modernImage && <MadeForModernLife image={modernImage} />}

      <ScrollRail
        products={bestSellers.data ?? []}
        eyebrow="Customer favourites"
        title="Most loved, again and again"
        description="The recipes our family reaches for week after week — reordered by thousands of homes."
        viewAllTo="/shop"
      />

      <section className="section" aria-label="Customer stories">
        <div className="container">
          <SectionHeader
            eyebrow="Proof, in their words"
            title="Loved across India"
            description="Unedited words from people who cook with Vedhi every week."
            align="center"
          />
          <Testimonials items={testimonials.data ?? []} loading={testimonials.loading} />
        </div>
      </section>

      <FaqSection
        eyebrow="Before you ask"
        title="Good to know"
        description="The questions every new family asks — answered straight."
      />

      {festiveActive && <FestiveSection />}

      <FinalCall onSubscribe={handleSubscribe} />
    </>
  )
}

/* ------------------------------------------------------------------ Hero strip */

function MarqueeBand() {
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__track">
        {[0, 1].map((copy) => (
          <div key={copy} className="marquee__group">
            {MARQUEE_WORDS.map((word) => (
              <span key={word} className="marquee__item">
                {word}
                <Icon name="leaf" size={14} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ Brand statement */

function BrandStatement() {
  return (
    <section className="section statement" aria-label="Our belief">
      <div className="container statement__inner">
        <Reveal variant="fade">
          <p className="type-eyebrow statement__eyebrow">Why we exist</p>
        </Reveal>
        <Reveal variant="up" delay={80}>
          <h2 className="statement__title">
            Food with <em>a story.</em>
          </h2>
        </Reveal>
        <Reveal variant="up" delay={160}>
          <p className="statement__copy">
            Our food begins with carefully selected single-origin ingredients, three generations of
            traditional knowledge, and a stubborn commitment to making everyday nourishment better.
            Never faster. Never easier. Always better.
          </p>
        </Reveal>
        <Reveal variant="up" delay={240}>
          <dl className="statement__facts">
            <div>
              <dt>40+</dt>
              <dd>partner organic farms</dd>
            </div>
            <div>
              <dt>3</dt>
              <dd>generations of recipes</dd>
            </div>
            <div>
              <dt>48h</dt>
              <dd>farm-fresh dispatch</dd>
            </div>
          </dl>
        </Reveal>
      </div>
    </section>
  )
}

/* -------------------------------------------------------- What makes us different */

function Philosophy({ images }: { images: string[] }) {
  return (
    <section className="section philosophy" aria-label="What makes Vedhi Foods different">
      <div className="container">
        <SectionHeader
          eyebrow="What makes it different"
          title="Honest food, four ways"
          description="Everything we make answers to the same four standards — not as slogans, as daily practice."
          align="center"
        />
        <ol className="principles">
          {PRINCIPLES.map((principle, index) => (
            <Reveal key={principle.n} as="li" delay={staggerDelay(index, 70)}>
              <article className="principle">
                <span className="principle__num" aria-hidden="true">
                  {principle.n}
                </span>
                <div className="principle__copy">
                  <h3 className="principle__title">
                    <Icon name={principle.icon} size={18} /> {principle.title}
                  </h3>
                  <p className="principle__text">{principle.copy}</p>
                </div>
                {images[index] && (
                  <img src={images[index]} alt="" loading="lazy" className="principle__img" />
                )}
              </article>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ Ingredient journey */

function IngredientJourney() {
  return (
    <section className="section section--tinted journey-sec" id="journey" aria-label="From soil to your table">
      <div className="container">
        <SectionHeader
          eyebrow="The journey"
          title="From soil to your table"
          description="Four honest steps between a single farm and your family's meal."
          align="center"
        />
        <Reveal variant="up" className="journey">
          <ol className="journey__track">
            {JOURNEY.map((stage, index) => (
              <li key={stage.title} className="journey__stage">
                <span className="journey__node" aria-hidden="true">
                  <Icon name={stage.icon} size={20} />
                </span>
                <p className="journey__step">Step {String(index + 1).padStart(2, '0')}</p>
                <h3>{stage.title}</h3>
                <p className="journey__copy">{stage.copy}</p>
              </li>
            ))}
            <span className="journey__line" aria-hidden="true" />
          </ol>
        </Reveal>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- Brand story teaser */

function StoryTeaser({ image }: { image: string }) {
  return (
    <section className="section story-teaser" id="story">
      <div className="container story-teaser__inner">
        <Reveal variant="right" className="story-teaser__media-wrap">
          <img src={image} alt="Heritage grains from native seed lines" loading="lazy" className="story-teaser__media" />
        </Reveal>
        <div className="story-teaser__copy">
          <SectionHeader
            eyebrow="Our story"
            title="From a family kitchen, since 2009"
            description="A village-market stall grew into a small-batch mill. The recipes, the sourcing and the standards never changed."
            align="left"
          />
          <ul className="story-teaser__milestones">
            {COMPANY_MILESTONES.slice(0, 2).map((milestone) => (
              <li key={milestone.year}>
                <span className="story-teaser__year">{milestone.year}</span>
                <span>
                  <strong>{milestone.title}</strong>
                  <span>{milestone.copy}</span>
                </span>
              </li>
            ))}
          </ul>
          <ButtonLink to="/about" variant="outline" iconRight="arrow-right">
            Read more of our story
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------- Made for modern life */

function MadeForModernLife({ image }: { image: string }) {
  return (
    <section className="section modern-sec" aria-label="Made for modern life">
      <div className="container modern">
        <Reveal variant="left" className="modern__media-wrap">
          <img src={image} alt="Ready-to-eat traditional meals in premium packaging" loading="lazy" className="modern__media" />
          <span className="modern__stamp" aria-hidden="true">
            Ready in minutes
          </span>
        </Reveal>
        <div className="modern__copy">
          <SectionHeader
            eyebrow="Made for modern life"
            title="Traditional roots. Modern convenience."
            description="The taste of your grandmother's kitchen, without the four-hour lead time."
            align="left"
          />
          <ul className="modern__list">
            {MODERN_FEATURES.map((feature) => (
              <li key={feature.title}>
                <span className="modern__list-icon">
                  <Icon name="check" size={15} />
                </span>
                <span>
                  <strong>{feature.title}</strong>
                  <span>{feature.copy}</span>
                </span>
              </li>
            ))}
          </ul>
          <ButtonLink to="/categories" variant="outline" iconRight="arrow-right">
            Explore the range
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- Festive promo band */

function FestiveSection() {
  return (
    <section className="section festive" aria-label="Festive promotion">
      <div className="container festive__inner">
        <div className="festive__copy">
          <p className="type-eyebrow festive__eyebrow">Festive goodness · Limited time</p>
          <h2 className="festive__title">
            Celebrate with a box of tradition.
          </h2>
          <p className="festive__desc">
            15% off festive gifting hampers until 31 October. Use <code className="festive__code">FESTIVE15</code> at checkout.
          </p>
          <div className="festive__actions">
            <ButtonLink to="/shop" size="lg" iconRight="arrow-right">
              Shop the festive box
            </ButtonLink>
          </div>
        </div>
        <div className="festive__seal" aria-hidden="true">
          <span className="festive__seal-ring">
            <span className="festive__seal-code">FESTIVE15</span>
            <span className="festive__seal-save">15% off</span>
          </span>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------- Final call */

function FinalCall({ onSubscribe }: { onSubscribe: (email: string) => Promise<void> }) {
  return (
    <section className="section finale" aria-label="Bring something good to your table">
      <div className="container finale__inner">
        <Reveal variant="scale">
          <h2 className="finale__title">
            Bring something <em>good</em> to your table.
          </h2>
        </Reveal>
        <p className="finale__lead">
          Explore the collection or hear the story first — either way, it starts with real food,
          grown the slow way.
        </p>
        <div className="finale__actions">
          <ButtonLink to="/shop" size="lg" iconRight="arrow-right">
            Explore the collection
          </ButtonLink>
          <ButtonLink to="/about" variant="outline" size="lg" icon="leaf">
            Discover our story
          </ButtonLink>
        </div>
        <NewsletterForm onSubscribe={onSubscribe} />
      </div>
    </section>
  )
}

function NewsletterForm({ onSubscribe }: { onSubscribe: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const { push } = useToast()

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (!/\S+@\S+\.\S+/.test(email)) {
      push({ title: 'Check your email', description: 'That doesn\u2019t look like a valid address.' })
      return
    }
    setBusy(true)
    try {
      await onSubscribe(email)
      setEmail('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="newsletter finale__newsletter" onSubmit={submit}>
      <label className="sr-only" htmlFor="newsletter-email">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        required
        placeholder="you@example.com — recipes, releases & offers"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" className="btn btn--primary btn--md" disabled={busy}>
        <span className="btn__label">{busy ? 'Signing up…' : 'Get the recipe'}</span>
      </button>
    </form>
  )
}