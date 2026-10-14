/**
 * Pagination input normalisation.
 *
 * SECURITY: several list endpoints read `limit`/`per_page` straight from the
 * query string with no upper bound:
 *
 *   const perPage = Math.max(1, parseInt(req.query.per_page as string) || 20)
 *   const limit   = parseInt(req.query.limit as string) || 20
 *
 * A caller could request `?limit=1000000` and force a single unbounded table
 * scan. Beyond the obvious availability cost (memory, serialisation time,
 * connection held for the duration), it converts any authenticated read
 * endpoint into a bulk data-exfiltration primitive: the entire staff directory,
 * or every invoice on the platform, in a single response.
 *
 * Clamping centrally keeps the ceiling consistent and makes the limit
 * enforceable in one place.
 */

/** Hard ceiling applied to every paginated list endpoint. */
export const MAX_PAGE_SIZE = 100

/** Defensive ceiling for any single search term. */
export const MAX_SEARCH_LENGTH = 200

/**
 * Coerces an arbitrary query-string page size into `[1, MAX_PAGE_SIZE]`.
 *
 * Non-numeric, negative, zero and `NaN` inputs all fall back to `fallback`
 * rather than propagating into a Prisma `take`, where `NaN` throws.
 */
export function clampPageSize(
  raw: unknown,
  fallback = 20,
  max: number = MAX_PAGE_SIZE
): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return Math.min(Math.max(1, fallback), max)
  }

  return Math.min(Math.trunc(parsed), max)
}

/** Coerces an arbitrary query-string page number into a positive integer. */
export function clampPageNumber(raw: unknown, fallback = 1): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback
  }

  return Math.trunc(parsed)
}

/** Trims and bounds a free-text search term. */
export function clampSearchTerm(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined

  const value = String(raw).trim()
  if (!value) return undefined

  return value.slice(0, MAX_SEARCH_LENGTH)
}
