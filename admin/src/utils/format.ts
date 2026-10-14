import { SITE } from '@/config/site'

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const inrFormatterDecimal = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** ₹1,299 — Indian numbering, no decimals by default. */
export function formatCurrency(value: number, options?: { decimals?: boolean }): string {
  if (!Number.isFinite(value)) return `${SITE.currencySymbol}0`
  return options?.decimals ? inrFormatterDecimal.format(value) : inrFormatter.format(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value)
}

export function formatCompact(value: number): string {
  return compactFormatter.format(value)
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${value.toFixed(fractionDigits)}%`
}

/** Percentage saved between mrp and price. Returns 0 when no discount. */
export function discountPercent(mrp: number, price: number): number {
  if (!mrp || mrp <= price) return 0
  return Math.round(((mrp - price) / mrp) * 100)
}

export function formatDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatRelativeTime(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  const minutes = Math.round(diff / 60_000)
  const hours = Math.round(diff / 3_600_000)
  const days = Math.round(diff / 86_400_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 30) return `${days}d ago`
  return formatDate(date)
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Builds up to `max` initials from a display name.
 *
 * SECURITY/RELIABILITY: this was `value: string` and called `.split()` directly,
 * so any caller that reached it with `undefined` threw
 * `TypeError: Cannot read properties of undefined (reading 'split')`. That is a
 * presentation helper — it must never be the thing that takes down a route, and
 * it is routinely fed values that come from persisted session state, API
 * responses and optional profile fields, any of which can be absent.
 *
 * Returns a neutral placeholder rather than throwing.
 */
export function initials(value: string | null | undefined, max = 2): string {
  if (typeof value !== 'string') return '?'

  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return parts || '?'
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function truncate(value: string | null | undefined, length: number): string {
  if (typeof value !== 'string') return '—'
  if (value.length <= length) return value
  return `${value.slice(0, length - 1).trimEnd()}…`
}
