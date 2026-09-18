import { useEffect, type RefObject } from 'react'

export function useEscapeKey(
  handler: (event: KeyboardEvent) => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return
    function listener(event: KeyboardEvent) {
      if (event.key === 'Escape') handler(event)
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [handler, active])
}

/** Small utility for a single optional ref target. */
export function useFocusFirst<T extends HTMLElement = HTMLElement>(
  containerRef: RefObject<T | null>,
  active = true,
): void {
  useEffect(() => {
    if (!active || !containerRef.current) return
    const focusable = containerRef.current.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    focusable?.focus()
  }, [active, containerRef])
}