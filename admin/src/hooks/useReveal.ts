import { useEffect, useRef, useState, type RefObject } from 'react'
import { prefersReducedMotion } from '@/utils/motion'

interface RevealOptions {
  /** 'up' | 'left' | 'right' | 'scale' | 'fade' */
  variant?: 'up' | 'left' | 'right' | 'scale' | 'fade'
  delay?: number
  threshold?: number
  /** Opt out so the element is visible immediately (e.g. above the fold). */
  disabled?: boolean
}

export function useReveal<T extends HTMLElement = HTMLDivElement>({
  variant = 'up',
  delay = 0,
  threshold = 0.12,
  disabled = false,
}: RevealOptions = {}): { ref: RefObject<T | null>; visible: boolean } {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(disabled)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (disabled || prefersReducedMotion()) {
      setVisible(true)
      element.classList.add('is-visible')
      return
    }

    element.style.setProperty('--reveal-delay', `${delay}ms`)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          element.classList.add('is-visible')
          observer.disconnect()
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [disabled, delay, threshold, variant])

  return { ref, visible }
}