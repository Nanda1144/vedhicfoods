import { useEffect, type RefObject } from 'react'

export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  refs: RefObject<T | null>[],
  handler: (event: MouseEvent | TouchEvent) => void,
): void {
  useEffect(() => {
    function listener(event: MouseEvent | TouchEvent) {
      const target = event.target as Node
      if (!target) return
      for (const ref of refs) {
        if (ref.current && ref.current.contains(target)) return
      }
      handler(event)
    }
    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)
    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [refs, handler])
}