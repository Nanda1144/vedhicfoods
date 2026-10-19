import crypto from 'crypto'
import { cacheDeleteByPrefix, cacheKey } from './cache'

/**
 * Key builders and invalidation for the public catalogue cache.
 *
 * The catalogue is read from many different filter/sort/pagination combinations
 * and from both the storefront and the admin console, so keys are derived from a
 * stable hash of the query rather than enumerated. Admin-scoped reads are never
 * cached, but the `scope` segment is kept so a future admin cache can never
 * collide with a public one.
 *
 * Invalidation is deliberately coarse: clearing all catalogue keys on any admin
 * mutation is cheap (the key space is small), cannot leave a stale key behind,
 * and is far easier to reason about than tracking which combinations a write
 * happened to affect. With the short TTLs in `cache.ts` this is more than safe
 * enough.
 */

export const PRODUCT_LIST_CACHE_PREFIX = cacheKey('products:list:')
export const PRODUCT_DETAIL_CACHE_PREFIX = cacheKey('products:detail:')
export const CATEGORY_LIST_CACHE_PREFIX = cacheKey('categories:list:')
export const CATEGORY_DETAIL_CACHE_PREFIX = cacheKey('categories:detail:')

/**
 * Stable, collision-resistant digest of a query object. `JSON.stringify`
 * preserves insertion order, and the Zod-parsed query object always has the same
 * key order, so the same query maps to the same key every time. The hash keeps
 * the Redis key short regardless of how many filters were supplied.
 */
function hashQuery(value: unknown): string {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

export function productListCacheKey(query: Record<string, unknown>, isAdmin: boolean): string {
  return `${PRODUCT_LIST_CACHE_PREFIX}${isAdmin ? 'admin' : 'public'}:${hashQuery(query)}`
}

export function productDetailCacheKey(idOrSlug: string, isAdmin: boolean): string {
  return `${PRODUCT_DETAIL_CACHE_PREFIX}${isAdmin ? 'admin' : 'public'}:${idOrSlug.toLowerCase()}`
}

export function categoryListCacheKey(activeOnly: boolean, featured: boolean | undefined): string {
  const featuredSegment = featured === undefined ? 'any' : String(featured)
  return `${CATEGORY_LIST_CACHE_PREFIX}${activeOnly ? 'active' : 'all'}:${featuredSegment}`
}

export function categoryDetailCacheKey(idOrSlug: string, activeOnly: boolean): string {
  return `${CATEGORY_DETAIL_CACHE_PREFIX}${activeOnly ? 'active' : 'all'}:${idOrSlug.toLowerCase()}`
}

/**
 * Clears every cached catalogue read.
 *
 * Product writes also clear the category keys because category payloads carry
 * product counts; category writes also clear the product keys because product
 * payloads embed the category name/slug. Clearing all four is the conservative,
 * obviously-correct choice.
 *
 * No-op (and never throws) when the cache is disabled or Redis is unavailable.
 */
export async function invalidateCatalogCaches(): Promise<void> {
  await Promise.all([
    cacheDeleteByPrefix(PRODUCT_LIST_CACHE_PREFIX),
    cacheDeleteByPrefix(PRODUCT_DETAIL_CACHE_PREFIX),
    cacheDeleteByPrefix(CATEGORY_LIST_CACHE_PREFIX),
    cacheDeleteByPrefix(CATEGORY_DETAIL_CACHE_PREFIX),
  ])
}
