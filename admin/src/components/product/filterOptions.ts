import { productService } from '@/services/productService'

export const RATING_OPTIONS = [
  { label: 'Any rating', value: '0' },
  { label: '4.5 ★ & above', value: '4.5' },
  { label: '4 ★ & above', value: '4' },
  { label: '3 ★ & above', value: '3' },
]

const PRICE_BOUNDS = productService.priceBounds()
const STEP = 100
const LOWER = Math.max(0, Math.floor((PRICE_BOUNDS.min - STEP) / STEP) * STEP)
const UPPER = Math.ceil((PRICE_BOUNDS.max + STEP) / STEP) * STEP

function ranges(): Array<{ label: string; min: number | null; max: number | null }> {
  const out: Array<{ label: string; min: number | null; max: number | null }> = []
  out.push({ label: `Up to ${formatNumberNumber(LOWER + STEP)}`, min: null, max: LOWER + STEP })
  for (let value = LOWER + STEP * 2; value < UPPER; value += STEP) {
    out.push({
      label: `${formatNumberNumber(value - STEP)} – ${formatNumberNumber(value)}`,
      min: value - STEP,
      max: value,
    })
  }
  out.push({ label: `${formatNumberNumber(UPPER - STEP)}+`, min: UPPER - STEP, max: null })
  return out
}

function formatNumberNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value)
}

export const PRICE_PRESETS = ranges()