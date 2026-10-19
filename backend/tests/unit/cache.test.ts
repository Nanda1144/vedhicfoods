import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeleteByPrefix,
  withCache,
  __setCacheClientForTests,
  __resetCacheForTests,
} from '../../src/utils/cache'

/**
 * Unit coverage for the optional Redis catalogue cache.
 *
 * These run without a live Redis: a fake client is injected through the
 * `__setCacheClientForTests` seam. The important guarantees are that the cache
 * is a pure optimisation — a miss, a disabled cache, or a failing Redis must all
 * fall through to the caller's producer rather than throwing or hanging.
 */

function makeFakeRedis() {
  const store = new Map<string, string>()
  const client: any = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]
      let removed = 0
      for (const key of list) {
        if (store.delete(key)) removed += 1
      }
      return removed
    }),
    scan: vi.fn(async (_cursor: number, options: { MATCH?: string }) => {
      const prefix = (options?.MATCH ?? '').replace(/\*$/, '')
      const keys = [...store.keys()].filter(key => key.startsWith(prefix))
      return { cursor: 0, keys }
    }),
  }
  return { client, store }
}

beforeEach(() => {
  __resetCacheForTests()
})

afterEach(() => {
  __resetCacheForTests()
  vi.restoreAllMocks()
})

describe('cache helper', () => {
  it('returns the cached value on a hit without invoking the producer', async () => {
    const { client } = makeFakeRedis()
    __setCacheClientForTests(client)

    await cacheSet('vedhicfoods:cache:test:hit', { value: 'cached' }, 60)

    const producer = vi.fn(async () => ({ value: 'database' }))
    const result = await withCache('vedhicfoods:cache:test:hit', 60, producer)

    expect(result).toEqual({ value: 'cached' })
    expect(producer).not.toHaveBeenCalled()
  })

  it('runs the producer and stores its result on a miss', async () => {
    const { client, store } = makeFakeRedis()
    __setCacheClientForTests(client)

    const producer = vi.fn(async () => [1, 2, 3])
    const result = await withCache('vedhicfoods:cache:test:miss', 30, producer)

    expect(result).toEqual([1, 2, 3])
    expect(producer).toHaveBeenCalledTimes(1)
    expect(store.get('vedhicfoods:cache:test:miss')).toBe('[1,2,3]')
  })

  it('deletes exact keys', async () => {
    const { client } = makeFakeRedis()
    __setCacheClientForTests(client)

    await cacheSet('vedhicfoods:cache:test:a', 'a', 60)
    await cacheDelete('vedhicfoods:cache:test:a')

    expect(await cacheGet('vedhicfoods:cache:test:a')).toBeNull()
  })

  it('deletes every key under a prefix without touching siblings', async () => {
    const { client } = makeFakeRedis()
    __setCacheClientForTests(client)

    await cacheSet('vedhicfoods:cache:products:list:1', 1, 60)
    await cacheSet('vedhicfoods:cache:products:list:2', 2, 60)
    await cacheSet('vedhicfoods:cache:products:detail:1', 3, 60)

    await cacheDeleteByPrefix('vedhicfoods:cache:products:list:')

    expect(await cacheGet('vedhicfoods:cache:products:list:1')).toBeNull()
    expect(await cacheGet('vedhicfoods:cache:products:list:2')).toBeNull()
    expect(await cacheGet('vedhicfoods:cache:products:detail:1')).toBe(3)
  })

  it('is a no-op when disabled: the producer still runs and nothing is cached', async () => {
    __setCacheClientForTests(null)

    const producer = vi.fn(async () => 'database-value')
    expect(await withCache('vedhicfoods:cache:test:disabled', 60, producer)).toBe('database-value')
    expect(producer).toHaveBeenCalledTimes(1)

    // Read/write helpers must not throw when there is no client.
    expect(await cacheGet('vedhicfoods:cache:test:disabled')).toBeNull()
    await expect(cacheSet('vedhicfoods:cache:test:disabled', 1, 60)).resolves.toBeUndefined()
    await expect(cacheDelete('vedhicfoods:cache:test:disabled')).resolves.toBeUndefined()
    await expect(cacheDeleteByPrefix('vedhicfoods:cache:test:')).resolves.toBeUndefined()
  })

  it('swallows read failures and serves the producer result', async () => {
    const client: any = {
      get: vi.fn(async () => {
        throw new Error('redis read failed')
      }),
      set: vi.fn(async () => 'OK'),
    }
    __setCacheClientForTests(client)

    const producer = vi.fn(async () => 'database-value')
    await expect(withCache('vedhicfoods:cache:test:failing-read', 60, producer)).resolves.toBe(
      'database-value',
    )
    expect(producer).toHaveBeenCalledTimes(1)
  })

  it('swallows write failures and still returns the producer result', async () => {
    const client: any = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw new Error('redis write failed')
      }),
      del: vi.fn(async () => {
        throw new Error('redis delete failed')
      }),
      scan: vi.fn(async () => {
        throw new Error('redis scan failed')
      }),
    }
    __setCacheClientForTests(client)

    const producer = vi.fn(async () => 'database-value')
    await expect(withCache('vedhicfoods:cache:test:failing-write', 60, producer)).resolves.toBe(
      'database-value',
    )

    await expect(cacheSet('vedhicfoods:cache:test:x', 1, 60)).resolves.toBeUndefined()
    await expect(cacheDelete('vedhicfoods:cache:test:x')).resolves.toBeUndefined()
    await expect(cacheDeleteByPrefix('vedhicfoods:cache:test:')).resolves.toBeUndefined()
  })

  it('propagates producer (database) errors unchanged', async () => {
    __setCacheClientForTests(null)

    const failure = new Error('database down')
    const producer = vi.fn(async () => {
      throw failure
    })

    await expect(withCache('vedhicfoods:cache:test:error', 60, producer)).rejects.toBe(failure)
  })
})
