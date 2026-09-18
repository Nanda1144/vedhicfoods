/** Motion helpers shared by hooks and non-React modules. */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Maps a stagger index onto the design-system delay steps (max 6). */
export function staggerDelay(index: number, stepMs = 60, maxSteps = 6): number {
  return Math.min(index, maxSteps - 1) * stepMs
}
