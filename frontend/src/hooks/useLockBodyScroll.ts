import { useEffect } from 'react'

/** Locks body scroll while an overlay/drawer is open. */
export function useLockBodyScroll(active = true): void {
  useEffect(() => {
    if (!active) return
    const original = document.body.style.overflow
    const originalPadding = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`

    return () => {
      document.body.style.overflow = original
      document.body.style.paddingRight = originalPadding
    }
  }, [active])
}