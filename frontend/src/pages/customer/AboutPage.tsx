import { COMPANY_MILESTONES, TRUST_BADGES } from '@/config/site'
import { PageHeader, SectionHeader, SectionLink, Reveal, ButtonLink, Icon, FaqSection } from '@/components/common'
import { Testimonials } from '@/components/home/Testimonials'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import type { IconName } from '@/components/common'
import traditionalPreparationImage from '@assets/body/Tradition-Preparation.webp'
import organicIngredientsImage from '@assets/body/organic-ingredients.webp'

const TRUST_ICONS: Array<IconName> = ['leaf', 'shield', 'truck', 'award']

const VALUES: Array<{ icon: IconName; title: string; copy: string }> = [
  { icon: 'leaf', title: 'Organic, always', copy: 'Certified organic sourcing with a full audit trail on every grain lot.' },
  { icon: 'heart', title: 'Handmade, in small lots', copy: 'Senior makers taste-test every batch; nothing is machine-batched at scale.' },
  { icon: 'truck', title: 'Fair to everyone', copy: 'Farmers, makers and customers — fair prices at every step of the chain.' },
]

export function AboutPage() {
  const testimonials = useAsync(() => contentService.testimonials(), [])

  return (
    <>
      <PageHeader
        eyebrow="Our story"
        title="Slow food, three generations deep"
        description="Vedhic Foods began in a home kitchen and grew into a quiet partnership with 40+ organic farms — without ever rushing a batch."
      />

      <section className="section section--alt trust-strip" aria-label="What we stand for">
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

      <section id="story" className="section">
        <div className="container">
          <div className="split split--feature">
            <Reveal className="split__media-wrap">
              <div
                className="split__media split__media--soft"
                style={{ backgroundImage: `url(${traditionalPreparationImage})` }}
                role="img"
                aria-label="Hands preparing traditional Indian food"
              />
            </Reveal>
            <div className="split__copy">
              <SectionHeader
                eyebrow="Since 2009"
                title="From a family kitchen in Kanakapura"
                description="What started as a village-market stall of hand-rolled millet laddus is today a small company with one stubborn rule: make everything the slow, traditional way."
                align="left"
              />
              <p className="body-copy">
                Each batch is stone-ground, slow-roasted and rolled by hand. We work only with farmers who grow native seed
                lines without chemicals, and we roast everything within days of milling — never from a warehouse shelf.
              </p>
              <div className="cluster cluster-3">
                <ButtonLink to="/shop">Try our range</ButtonLink>
                <ButtonLink to="/contact" variant="outline">
                  Talk to us
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <SectionHeader
            eyebrow="The journey"
            title="Milestones on the farm road"
            description="The work has never been about scaling fast — it's about doing the same things well, year after year."
          />
          <ol className="timeline">
            {COMPANY_MILESTONES.map((milestone, index) => (
              <Reveal key={milestone.year} as="li" delay={index * 90} className="timeline__item">
                <span className="timeline__year">{milestone.year}</span>
                <div className="timeline__card">
                  <h3>{milestone.title}</h3>
                  <p>{milestone.copy}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="split split--swapped">
            <div className="split__copy">
              <SectionHeader
                eyebrow="Our promise"
                title="Traceable from soil to shelf"
                description="Every jar and pack carries a lot number that maps back to a single farm and harvest season — so you always know exactly what you're eating and who grew it."
                align="left"
              />
              <p className="body-copy">
                No fillers, no preservatives and no artificial colours. Shelf life comes from ghee, careful roasting and
                clean packing — the same way it has for generations. What we can't grow ourselves, we buy direct from
                farmers we know by name.
              </p>
              <div className="cluster cluster-3">
                <ButtonLink to="/faq" variant="outline">
                  Read our FAQ
                </ButtonLink>
              </div>
            </div>
            <Reveal className="split__media-wrap">
              <div
                className="split__media split__media--soft"
                style={{ backgroundImage: `url(${organicIngredientsImage})` }}
                role="img"
                aria-label="Organic ingredients laid out on a wooden surface"
              />
            </Reveal>
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <SectionHeader
            eyebrow="What guides us"
            title="Three rules we never break"
            description="Everything else can change — the packaging, the menu, the channels. These don't."
          />
          <div className="value-grid">
            {VALUES.map((value) => (
              <Reveal key={value.title} className="value-card">
                <span className="value-card__icon">
                  <Icon name={value.icon} size={20} />
                </span>
                <h3>{value.title}</h3>
                <p>{value.copy}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            eyebrow="In their words"
            title="What families tell us"
            action={<SectionLink to="/faq">Read our FAQ</SectionLink>}
          />
          <Testimonials items={testimonials.data ?? []} loading={testimonials.loading} />
        </div>
      </section>

      <section className="section section--alt">
        <div className="container">
          <FaqSection
            eyebrow="Quick answers"
            title="Questions we hear a lot"
            description="The essentials on our organic sourcing, shipping and returns — in plain words."
          />
        </div>
      </section>
    </>
  )
}
