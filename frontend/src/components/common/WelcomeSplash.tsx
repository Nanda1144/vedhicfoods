import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '@/context'
import { usePrefersReducedMotion } from '@/hooks'
import { Icon } from './Icon'

const STORAGE_KEY = 'vedhic.welcome.shown.v1'
const HOLD_MS = 2200
const FADE_MS = 350

function hasBeenShown(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function markShown(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Private mode and quota failures must never break the storefront.
  }
}

export function WelcomeSplash() {
  const { settings } = useSettings()
  const reducedMotion = usePrefersReducedMotion()
  const [visible, setVisible] = useState(() => !reducedMotion && !hasBeenShown())
  const [leaving, setLeaving] = useState(false)
  const leavingRef = useRef(false)
  const holdTimer = useRef<number | null>(null)
  const fadeTimer = useRef<number | null>(null)

  const beginLeave = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true

    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }

    setLeaving(true)
    fadeTimer.current = window.setTimeout(() => {
      fadeTimer.current = null
      setVisible(false)
    }, FADE_MS)
  }, [])

  useEffect(() => {
    if (reducedMotion) {
      markShown()
      setVisible(false)
      return
    }

    if (!visible) return

    markShown()
    holdTimer.current = window.setTimeout(beginLeave, HOLD_MS)

    return () => {
      if (holdTimer.current !== null) {
        window.clearTimeout(holdTimer.current)
        holdTimer.current = null
      }
      if (fadeTimer.current !== null) {
        window.clearTimeout(fadeTimer.current)
        fadeTimer.current = null
      }
    }
  }, [reducedMotion, visible, beginLeave])

  useEffect(() => {
    if (!visible || reducedMotion) return

    const onKeyDown = () => beginLeave()
    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible, reducedMotion, beginLeave])

  if (reducedMotion || !visible) return null

  const brandName = settings.brandName || 'Vedhic Foods'
  const logoUrl = (settings.logoUrl ?? '').trim()

  return (
    <div
      className={`welcome-splash${leaving ? ' welcome-splash--leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`Welcome to ${brandName}`}
      onClick={beginLeave}
    >
      <div className="welcome-splash__panel">
        <span className={`welcome-splash__logo${logoUrl ? ' welcome-splash__logo--image' : ''}`}>
          {logoUrl ? (
            <img src={logoUrl} alt="" />
          ) : (
            <Icon name="leaf" size={36} strokeWidth={1.4} />
          )}
        </span>
        <p className="welcome-splash__brand">{brandName}</p>
        {settings.tagline && <p className="welcome-splash__tagline">{settings.tagline}</p>}
      </div>
    </div>
  )
}
