import { useCallback, useState } from 'react'
import { SITE, TRUST_BADGES, COMPANY_MILESTONES } from '@/config/site'
import { productService } from '@/services/productService'
import { contentService, newsletterService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import { useToast, useSettings } from '@/context'
import type { IconName } from '@/components/common'
import {
  Icon,
  ButtonLink,
  SectionHeader,
  SectionLink,
  Reveal,
  Badge,
  ProductGridSkeleton,
} from '@/components/common'
import { ProductGrid, CategoryCard } from '@/components/product'
import { Testimonials } from '@/components/home/Testimonials'

const TRUST_ICONS: Array<IconName> = ['leaf', 'shield', 'truck', 'award']

const FEATURES: Array<{ icon: IconName; title: string; copy: string }> = [
  { icon: 'leaf', title: 'Certified organic sourcing', copy: 'India Organic & Jaivik Bharat audit trails on every lot.' },
  { icon: 'shield', title: 'Zero preservatives', copy: 'Nothing artificial — ever. Our shelf life comes from ghee, care and heat.' },
  { icon: 'truck', title: 'Small-batch freshness', copy: 'Made weekly and dispatched within 48 hours of production.' },
  { icon: 'award', title: 'Fair to farmers', copy: '40+ smallholder farms paid above market rates, year-round.' },
]

const TRADITIONAL_STEPS: Array<{ icon: IconName; title: string; copy: string }> = [
  { icon: 'leaf', title: 'Single-origin harvests', copy: 'Every lot traces to one farm and one season of certified organic grain.' },
  { icon: 'clock', title: 'Slow-roasted, low flame', copy: 'Stone-ground in small lots and roasted gently — never rushed, never reused oil.' },
  { icon: 'box', title: 'Made fresh every week', copy: 'Rolled, pressed and packed by hand in weekly batches, never warehoused.' },
  { icon: 'truck', title: 'Traced to your door', copy: 'A harvest-lot code on every pack, shipped within 48 hours of production.' },
]

const ORGANIC_VALUES: Array<{ icon: IconName; title: string; copy: string }> = [
  { icon: 'leaf', title: 'Certified organic', copy: 'India Organic & Jaivik Bharat certified, audited twice a year.' },
  { icon: 'shield', title: 'No preservatives or colour', copy: 'Shelf life comes from ghee, jaggery and patient drying — never chemistry.' },
  { icon: 'star', title: 'Heirloom native seeds', copy: 'Khapli wheat, native red rice and heritage millets saved from native seed lines.' },
  { icon: 'check-circle', title: 'Fair to the farmers who grow it', copy: 'Paid above market rates to 40+ smallholder farms, year-round.' },
]

export function HomePage() {
  const { settings } = useSettings()
  const { push } = useToast()

  const bestSellers = useAsync(() => productService.bestSellers(4), [])
  const premium = useAsync(() => productService.featured(6), [])
  const testimonials = useAsync(() => contentService.testimonials(), [])
  const categories = useAsync(() => productService.categories(), [])
  const featuredCategories = categories.data?.filter((category) => category.featured).slice(0, 4) ?? []

  const handleSubscribe = useCallback(
    async (email: string) => {
      await newsletterService.subscribe(email)
      push({ title: 'Welcome to the family', description: 'Your first recipe guide is on its way.' })
    },
    [push],
  )

  return (
    <>
      <Hero announcement={settings.announcementActive ? settings.announcement : settings.tagline} />

      <section className="section section--alt trust-strip" aria-label="Why shop with Vedhi">
        <div className="container trust-strip__grid">
          {TRUST_BADGES.map((badge, index) => (
            <div key={badge.title} className="trust-strip__item">
              <span className="trust-strip__icon">
                <Icon name={TRUST_ICONS[index] ?? 'leaf'} size={20} />
              </span>
              <span>
                <strong>{badge.title}</strong>
                <span>{badge.copy}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="categories">
        <div className="container">
          <SectionHeader
            eyebrow="Shop by taste"
            title="From our kitchen, to yours"
            description="Every category is made in small batches from single-origin organic grains."
            action={<SectionLink to="/categories">View all categories</SectionLink>}
          />
          <div className="category-grid category-grid--4">
            {featuredCategories.map((category, index) => (
              <Reveal key={category.id} delay={index * 60}>
                <CategoryCard category={category} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt" id="bestsellers">
        <div className="container">
          <SectionHeader
            eyebrow="Customer favourites"
            title="The bestsellers"
            description="Most-loved recipes, reordered again and again."
            action={<SectionLink to="/shop">Shop all</SectionLink>}
          />
          {bestSellers.loading ? (
            <ProductGridSkeleton count={4} />
          ) : bestSellers.data?.length ? (
            <ProductGrid products={bestSellers.data} />
          ) : null}
        </div>
      </section>

      <section className="section" id="premium">
        <div className="container">
          <SectionHeader
            eyebrow="Crafted for connoisseurs"
            title="The premium range"
            description="Festival-grade laddus, gifting boxes and small-batch specials worth lingering over."
            action={<SectionLink to="/shop">Shop all</SectionLink>}
          />
          {premium.loading ? (
            <ProductGridSkeleton count={6} />
          ) : premium.data?.length ? (
            <ProductGrid products={premium.data} />
          ) : null}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="split split--feature">
            <Reveal className="split__media-wrap">
              <div
                className="split__media"
                style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80)' }}
                role="img"
                aria-label="A farm basket of organic grains and millets"
              />
            </Reveal>
            <div className="split__copy">
              <SectionHeader
                eyebrow="Why Vedhi"
                title="Slow-made, honestly priced, deeply good"
                description="We pay real prices to real farmers, mill in small lots and never cut corners with preservatives."
                align="left"
              />
              <ul className="feature-list">
                {FEATURES.map((item) => (
                  <li key={item.title} className="feature-item">
                    <span className="feature-item__icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span className="feature-item__copy">
                      <strong>{item.title}</strong>
                      <span>{item.copy}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <ButtonLink to="/about" variant="outline">
                More about us
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--tinted" id="traditional">
        <div className="container">
          <div className="split">
            <Reveal className="split__media-wrap">
              <div
                className="split__media"
                style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=1200&q=80)' }}
                role="img"
                aria-label="A hand ground bowl of millet flour being prepared"
              />
            </Reveal>
            <div className="split__copy">
              <SectionHeader
                eyebrow="Traditional preparation"
                title="Made the way grandmothers made it"
                description="No shortcuts are cheaper here. Every recipe follows the slow methods our founder learnt in her family kitchen."
                align="left"
              />
              <ul className="feature-list">
                {TRADITIONAL_STEPS.map((item) => (
                  <li key={item.title} className="feature-item">
                    <span className="feature-item__icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span className="feature-item__copy">
                      <strong>{item.title}</strong>
                      <span>{item.copy}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="ingredients">
        <div className="container">
          <div className="split split--swapped">
            <div className="split__copy">
              <SectionHeader
                eyebrow="Organic ingredients"
                title="Grown in soil, not sprayed into shape"
                description="Single-origin grains from 40+ partner farms, certified organic and milled within days of harvest."
                align="left"
              />
              <ul className="feature-list">
                {ORGANIC_VALUES.map((item) => (
                  <li key={item.title} className="feature-item">
                    <span className="feature-item__icon">
                      <Icon name={item.icon} size={18} />
                    </span>
                    <span className="feature-item__copy">
                      <strong>{item.title}</strong>
                      <span>{item.copy}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <ButtonLink to="/categories" variant="outline" iconRight="arrow-right">
                Explore the range
              </ButtonLink>
            </div>
            <Reveal className="split__media-wrap">
              <div
                className="split__media"
                style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=1200&q=80)' }}
                role="img"
                aria-label="Greens growing on an organic farm"
              />
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <SectionHeader
            eyebrow="Proof, in their words"
            title="Loved across India"
            description="Unedited reviews from people who cook with Vedhi every week."
          />
          <Testimonials items={testimonials.data ?? []} loading={testimonials.loading} />
        </div>
      </section>

      <section className="section" id="story">
        <div className="container">
          <SectionHeader
            eyebrow="Our story"
            title="Slow food, since 2009"
            description="A family kitchen grew into a small-batch mill — the recipes, the sourcing and the standards never changed."
            align="center"
          />
          <div className="milestones">
            {COMPANY_MILESTONES.map((milestone, index) => (
              <Reveal key={milestone.year} delay={index * 80}>
                <article className="milestone-card">
                  <span className="milestone-card__year">{milestone.year}</span>
                  <h3>{milestone.title}</h3>
                  <p>{milestone.copy}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <div className="milestones__cta">
            <ButtonLink to="/about" size="lg" iconRight="arrow-right">
              Read more of our story
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="section section--tinted">
        <div className="container">
          <div className="banner-cta">
            <div className="banner-cta__copy">
              <p className="type-eyebrow">Seasonal &amp; festive</p>
              <h2>Get 10% off your first order</h2>
              <p>Sign up for recipes, festival releases and members-only offers this festive season. Unsubscribe anytime.</p>
            </div>
            <NewsletterForm onSubscribe={handleSubscribe} />
          </div>
        </div>
      </section>
    </>
  )
}

function Hero({ announcement }: { announcement: string }) {
  return (
    <section className="hero">
      <div className="hero__bg" aria-hidden="true">
        <span className="hero__bg-sphere hero__bg-sphere--gold" />
        <span className="hero__bg-sphere hero__bg-sphere--olive" />
        <span className="hero__bg-wheel" />
        <span className="hero__bg-ring hero__bg-ring--a" />
        <span className="hero__bg-ring hero__bg-ring--b" />
      </div>
      <div className="hero__inner container">
        <div className="hero__copy">
          <Badge tone="accent" dot>
            {announcement}
          </Badge>
          <h1 className="hero__title">
            Traditional Indian goodness
            <span className="text-accent"> grown the slow way</span>
          </h1>
          <p className="hero__lead">{SITE.description}</p>
          <div className="hero__actions">
            <ButtonLink to="/shop" size="lg" iconRight="arrow-right">
              Shop now
            </ButtonLink>
            <ButtonLink to="/shop" variant="outline" size="lg" icon="leaf">
              Explore products
            </ButtonLink>
          </div>
          <div className="hero__perks">
            {TRUST_BADGES.slice(0, 3).map((badge, index) => (
              <span key={badge.title} className="chip chip--ghost">
                <Icon name={TRUST_ICONS[index]} size={15} />
                {badge.title}
              </span>
            ))}
          </div>
        </div>
        <div className="hero__media" aria-hidden="true">
          <div className="hero__plate">
            <div className="hero__plate-glow" />
            <div className="hero__plate-laddu is-1" />
            <div className="hero__plate-laddu is-2" />
            <div className="hero__plate-laddu is-3" />
            <span className="hero__caption">Slow-made · Small-batch</span>
          </div>
        </div>
      </div>
      <div className="hero__grain" aria-hidden="true" />
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
    <form className="newsletter" onSubmit={submit}>
      <label className="sr-only" htmlFor="newsletter-email">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" className="btn btn--primary btn--md" disabled={busy}>
        <span className="btn__label">{busy ? 'Signing up…' : 'Get the recipe'}</span>
      </button>
    </form>
  )
}