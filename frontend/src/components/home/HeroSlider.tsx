import { useCallback, useEffect, useMemo, useState } from 'react'
import { TRUST_BADGES } from '@/config/site'
import { HERO_FIXED_HEADING, HERO_SUBTITLE, heroSlidesFor } from '@/config/heroSlides'
import { useMediaQuery, usePrefersReducedMotion } from '@/hooks'
import { useSettings } from '@/context'
import { Badge, ButtonLink, Icon, type IconName } from '@/components/common'
import { HeroPagination } from './HeroPagination'
import { TypingHeadline } from './TypingHeadline'

/** Storefront breakpoint: below this the mobile image set is preferred. */
const MOBILE_QUERY = '(max-width: 767px)'

/** Total time each slide is on screen — kept inside the requested 3–4s window. */
const SLIDE_MS = 3500
/** Milliseconds per character while the word is typed. */
const TYPE_MS = 70
/** Milliseconds per character while the word is deleted. */
const DELETE_MS = 40
/** Breathing room before advancing, in case a word is unusually long. */
const MIN_HOLD_MS = 600

const TRUST_ICONS: IconName[] = ['leaf', 'shield', 'truck', 'award']

type Phase = 'typing' | 'deleting'

export interface HeroSliderProps {
  /** Announcement / tagline shown in the hero badge. */
  announcement: string
}

/**
 * Cinematic, responsive hero slider.
 *
 * - Backgrounds cross-fade in the fixed brand-journey order (see `heroSlides`).
 * - The heading's final word is typed/deleted in lock-step with the image: a
 *   single timeline drives both, so the word can never drift from its slide.
 * - Wide screens use `assests/desktop`, narrow screens use `assests/mobile`
 *   through the `<picture>` element, so only one variant is ever fetched.
 * - Only the active slide and its immediate neighbours hold a `src`, so images
 *   stream in rather than all downloading up front.
 */
export function HeroSlider({ announcement }: HeroSliderProps) {
  const { settings } = useSettings()
  const isNarrow = useMediaQuery(MOBILE_QUERY)
  const reducedMotion = usePrefersReducedMotion()

  const slides = useMemo(() => heroSlidesFor(settings.heroImages), [settings.heroImages])
  const total = slides.length

  // `index` only ever grows; the visible slide is derived, so the list can shrink
  // (admin edits) without leaving an out-of-range active slide.
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('typing')
  const [count, setCount] = useState(0)
  const [hovering, setHovering] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [userPaused, setUserPaused] = useState(false)

  const active = total > 0 ? index % total : 0
  const paused = hovering || focusWithin || userPaused || reducedMotion
  const slide = slides[active]
  const word = slide?.word ?? ''

  // Keep the active slide plus its neighbours mounted: the neighbour is warm for
  // the next cross-fade, and the previous one can finish fading out.
  const armed = useMemo(() => {
    const warm = new Set<number>()
    if (total === 0) return warm
    for (let offset = -1; offset <= 1; offset += 1) {
      warm.add((((active + offset) % total) + total) % total)
    }
    return warm
  }, [active, total])

  // The single timeline: type → hold → delete → advance. Exactly one timer is
  // ever scheduled, and each is cleared on unmount, slide change or pause.
  useEffect(() => {
    if (paused || word.length === 0) return

    if (phase === 'typing') {
      if (count < word.length) {
        const timer = window.setTimeout(() => setCount((value) => value + 1), TYPE_MS)
        return () => window.clearTimeout(timer)
      }
      if (total <= 1) return
      const hold = Math.max(SLIDE_MS - word.length * (TYPE_MS + DELETE_MS), MIN_HOLD_MS)
      const timer = window.setTimeout(() => setPhase('deleting'), hold)
      return () => window.clearTimeout(timer)
    }

    if (count > 0) {
      const timer = window.setTimeout(() => setCount((value) => value - 1), DELETE_MS)
      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => {
      setIndex((value) => value + 1)
      setPhase('typing')
      setCount(0)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [phase, count, word, paused, total])

  // Manual selection resets and re-synchronises the whole animation.
  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return
      setPhase('typing')
      setCount(0)
      setIndex(((next % total) + total) % total)
    },
    [total],
  )

  const text = reducedMotion ? word : word.slice(0, count)

  return (
    <section
      className="hero"
      role="region"
      aria-roledescription="carousel"
      aria-label="Vedhic Foods showcase"
      onMouseEnter={isNarrow ? undefined : () => setHovering(true)}
      onMouseLeave={isNarrow ? undefined : () => setHovering(false)}
    >
      <div className="hero__bg" aria-hidden="true">
        {total > 0 && (
          <div className="hero__bg-images">
            {slides.map((item, layer) => (
              <picture
                key={item.id}
                className={`hero__bg-image${layer === active ? ' is-active' : ''}`}
              >
                {armed.has(layer) && (
                  <>
                    <source media={MOBILE_QUERY} srcSet={item.mobile} />
                    <img
                      src={item.desktop}
                      alt=""
                      loading={layer === 0 ? 'eager' : 'lazy'}
                      fetchPriority={layer === 0 ? 'high' : 'auto'}
                      decoding="async"
                      style={{ objectPosition: isNarrow ? item.focalMobile : item.focalDesktop }}
                    />
                  </>
                )}
              </picture>
            ))}
            <span className="hero__bg-scrim" />
          </div>
        )}
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
          <h1 className="hero__title" aria-label={`${HERO_FIXED_HEADING} ${word}`}>
            <TypingHeadline text={text} reducedMotion={reducedMotion} />
          </h1>
          <p className="hero__lead">{HERO_SUBTITLE}</p>
          <div className="hero__actions">
            <ButtonLink to="/shop" size="lg" iconRight="arrow-right">
              {settings.heroCtaLabel || 'Shop now'}
            </ButtonLink>
            <ButtonLink to="/shop" variant="outline" size="lg" icon="leaf">
              Explore products
            </ButtonLink>
          </div>
          <div className="hero__perks">
            {TRUST_BADGES.slice(0, 3).map((badge, badgeIndex) => (
              <span key={badge.title} className="chip chip--ghost">
                <Icon name={TRUST_ICONS[badgeIndex] ?? 'leaf'} size={15} />
                {badge.title}
              </span>
            ))}
          </div>
        </div>
        <HeroPagination
          count={total}
          index={active}
          onSelect={goTo}
          paused={userPaused}
          onTogglePause={() => setUserPaused((value) => !value)}
          reducedMotion={reducedMotion}
          onFocusWithinChange={setFocusWithin}
        />
      </div>
      <div className="hero__grain" aria-hidden="true" />
    </section>
  )
}
