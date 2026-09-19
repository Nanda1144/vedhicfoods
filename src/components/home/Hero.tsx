import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ButtonLink } from '@/components/common'
import { prefersReducedMotion } from '@/utils/motion'

export interface HeroIngredient {
  image: string
  label: string
  sub: string
  /** Floating chip position class. */
  position: 'a' | 'b' | 'c' | 'd'
}

interface ImmerseHeroProps {
  announcement: string
  dishImage: string
  ingredients: HeroIngredient[]
}

const MAX_X = 1
const MAX_Y = 1

/**
 * Immersive editorial opener.
 * - Renders a warm, layered "soil to table" composition instead of a generic
 *   hero image + navbar + button.
 * - Mouse parallax: layers drift at different depths (translate3d only).
 * - Scroll-out: the whole canvas gently rises, fades and scales away.
 * Touch devices & reduced-motion users get a still, fully readable hero.
 */
export function ImmerseHero({ announcement, dishImage, ingredients }: ImmerseHeroProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const [out, setOut] = useState(false)

  useEffect(() => {
    const section = sectionRef.current
    if (!section) return

    const reduced = prefersReducedMotion()
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches

    let raf = 0

    const onMove = (event: PointerEvent) => {
      if (reduced || coarsePointer) return
      const rect = section.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const nx = (x / Math.max(1, rect.width)) * 2 - 1
      const ny = (y / Math.max(1, rect.height)) * 2 - 1
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        section.style.setProperty('--mx', String(Math.max(-MAX_X, Math.min(MAX_X, nx))))
        section.style.setProperty('--my', String(Math.max(-MAX_Y, Math.min(MAX_Y, ny))))
      })
    }

    const onLeave = () => {
      section.style.setProperty('--mx', '0')
      section.style.setProperty('--my', '0')
    }

    const onScroll = () => {
      if (reduced) return
      setOut(window.scrollY > 420)
    }

    section.addEventListener('pointermove', onMove, { passive: true })
    section.addEventListener('pointerleave', onLeave)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      section.removeEventListener('pointermove', onMove)
      section.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section
      ref={sectionRef}
      className={out ? 'hero-x is-out' : 'hero-x'}
      aria-label="Vedhi Foods — from the soil to your table"
    >
      {/* Backdrop — grain, orbs & organic leaf shapes, slowest layer */}
      <div className="hero-x__bg" aria-hidden="true" data-depth="-26">
        <span className="hero-x__orb hero-x__orb--gold" />
        <span className="hero-x__orb hero-x__orb--olive" />
        <span className="hero-x__ring hero-x__ring--a" />
        <span className="hero-x__ring hero-x__ring--b" />
        <span className="hero-x__leaf hero-x__leaf--a" />
        <span className="hero-x__leaf hero-x__leaf--b" />
      </div>

      <div className="container hero-x__inner">
        <div className="hero-x__copy" data-depth="-10">
          <p className="hero-x__eyebrow">
            <span className="hero-x__eyebrow-dot" aria-hidden="true" />
            {announcement}
          </p>

          <h1 className="hero-x__title">
            From the soil.
            <em className="hero-x__title-em">To your table.</em>
          </h1>

          <p className="hero-x__lead">
            Traditional Indian goodness — organic millets, slow-roasted laddu and hand-pressed
            rotis, thoughtfully prepared for modern living.
          </p>

          <div className="hero-x__actions">
            <ButtonLink to="/shop" size="lg" iconRight="arrow-right">
              Explore the collection
            </ButtonLink>
            <ButtonLink to="/about" variant="outline" size="lg" icon="leaf">
              Our story
            </ButtonLink>
          </div>

          <ul className="hero-x__mini" aria-label="Why Vedhi Foods">
            <li>Certified organic</li>
            <li>Small-batch made</li>
            <li>Farm &amp; harvest traced</li>
          </ul>
        </div>

        {/* Food composition — centre dish + floating ingredient chips */}
        <div className="hero-x__stage" data-depth="-18" aria-hidden="true">
          <div className="hero-x__dish">
            <div className="hero-x__dish-halo" />
            <img src={dishImage} alt="" className="hero-x__dish-img" />
            <span className="hero-x__dish-dust hero-x__dish-dust--a" />
            <span className="hero-x__dish-dust hero-x__dish-dust--b" />
            <span className="hero-x__dish-dust hero-x__dish-dust--c" />
          </div>

          {ingredients.slice(0, 4).map((ingredient, index) => (
            <figure
              key={ingredient.label}
              className={`hero-x__chip hero-x__chip--${ingredient.position}`}
              style={{ '--chip-idx': index } as CSSProperties}
            >
              <img src={ingredient.image} alt="" />
              <figcaption>
                <strong>{ingredient.label}</strong>
                <span>{ingredient.sub}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className="hero-x__cue" aria-hidden="true">
        <span>Scroll to taste</span>
        <span className="hero-x__cue-line" />
      </div>
    </section>
  )
}