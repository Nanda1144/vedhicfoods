import { HERO_FIXED_HEADING } from '@/config/heroSlides'

export interface TypingHeadlineProps {
  /** The dynamic final word, already sliced to the number of typed letters. */
  text: string
  /** When true the word is shown in full and the caret is hidden. */
  reducedMotion?: boolean
}

/**
 * Renders the fixed heading plus the slide-synced animated word.
 *
 * Purely presentational — the type/hold/delete timeline lives in `HeroSlider`
 * so there is exactly one source of truth and no competing timers.
 */
export function TypingHeadline({ text, reducedMotion = false }: TypingHeadlineProps) {
  return (
    <span className="hero__title-line" aria-hidden="true">
      <span className="hero__title-fixed">{HERO_FIXED_HEADING}</span>{' '}
      <span className="hero__title-dynamic">
        <span className="hero__typed">{text}</span>
        {!reducedMotion && <span className="hero__caret" />}
      </span>
    </span>
  )
}
