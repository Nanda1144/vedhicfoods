import { Icon } from '@/components/common'

export interface HeroPaginationProps {
  /** Number of slides. */
  count: number
  /** Index of the active slide. */
  index: number
  /** Manual slide selection — resets and re-syncs the animation. */
  onSelect: (index: number) => void
  /** Whether automatic progression is currently paused. */
  paused: boolean
  /** Toggle the pause/play control. */
  onTogglePause: () => void
  /** When true the pause/play control is hidden (no automatic movement). */
  reducedMotion?: boolean
  /** Pause while keyboard focus is inside the controls. */
  onFocusWithinChange: (focused: boolean) => void
}

/** Accessible slide indicators plus a pause/play control. */
export function HeroPagination({
  count,
  index,
  onSelect,
  paused,
  onTogglePause,
  reducedMotion = false,
  onFocusWithinChange,
}: HeroPaginationProps) {
  return (
    <div
      className="hero__controls"
      role="group"
      aria-label="Hero slideshow controls"
      onFocus={() => onFocusWithinChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onFocusWithinChange(false)
        }
      }}
    >
      <ul className="hero__dots">
        {Array.from({ length: count }, (_, dot) => (
          <li key={dot}>
            <button
              type="button"
              className={`hero__dot${dot === index ? ' is-active' : ''}`}
              aria-label={`Show slide ${dot + 1} of ${count}`}
              aria-current={dot === index}
              onClick={() => onSelect(dot)}
            />
          </li>
        ))}
      </ul>
      {!reducedMotion && (
        <button
          type="button"
          className="hero__playpause"
          aria-label={paused ? 'Play slideshow' : 'Pause slideshow'}
          aria-pressed={paused}
          onClick={onTogglePause}
        >
          <Icon name={paused ? 'play' : 'pause'} size={16} />
        </button>
      )}
    </div>
  )
}
