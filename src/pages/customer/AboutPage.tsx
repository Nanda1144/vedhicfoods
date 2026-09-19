import { COMPANY_MILESTONES } from '@/config/site'
import { PageHeader, SectionHeader, SectionLink, Reveal, ButtonLink, Icon } from '@/components/common'
import { Testimonials, FaqSection } from '@/components/home'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import type { IconName } from '@/components/common'

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
        description="Vedhi Foods began in a home kitchen and grew into a quiet partnership with 40+ organic farms — without ever rushing a batch."
      />

      <section id="story" className="section">
        <div className="container">
          <div className="split split--feature">
            <div
              className="split__media"
              style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1515378791036-0648a3ef77b2?auto=format&fit=crop&w=1200&q=80)' }}
              role="img"
              aria-label="Hands preparing traditional Indian food"
            />
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

      <FaqSection
        limit={4}
        eyebrow="Good to know"
        title="Questions families ask"
        description="Sourcing, shelf life and how our small-batch kitchen ships to your home."
      />

      <section className="section section--alt">
        <div className="container">
          <SectionHeader
            eyebrow="In their words"
            title="What families tell us"
            action={<SectionLink to="/faq">Read our FAQ</SectionLink>}
          />
          <Testimonials items={testimonials.data ?? []} loading={testimonials.loading} />
        </div>
      </section>
    </>
  )
}