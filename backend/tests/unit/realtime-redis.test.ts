import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RoleName } from '@prisma/client'

/**
 * Realtime hub Redis pub/sub fan-out.
 *
 * `REDIS_URL` is mocked as set so the fan-out path activates, but the actual
 * client is replaced with a fake via `__setRealtimeRedisFactoryForTests`, so no
 * live Redis is required. These tests pin the delivery contract:
 *
 *   - the origin instance delivers locally exactly once (its own Redis echo is
 *     ignored), and fans the event out to Redis for siblings;
 *   - a message from a sibling is delivered locally and is *not* re-published;
 *   - identity-based channel filtering is unchanged;
 *   - a Redis outage degrades to local-only delivery without throwing.
 */
vi.mock('../../src/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env')
  return {
    ...actual,
    env: {
      ...actual.env,
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6399',
    },
  }
})

import {
  realtime,
  __setRealtimeRedisFactoryForTests,
  __resetRealtimeForTests,
} from '../../src/events/realtime'

interface FakeRedis {
  connect: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
  published: Array<{ channel: string; message: string }>
  emit: (message: string) => void
}

function makeFakeRedis(): FakeRedis {
  let listener: ((message: string) => void) | null = null
  const published: Array<{ channel: string; message: string }> = []

  const client: FakeRedis = {
    connect: vi.fn(async () => undefined),
    on: vi.fn(() => client),
    subscribe: vi.fn(async (_channel: string, callback: (message: string) => void) => {
      listener = callback
    }),
    publish: vi.fn(async (channel: string, message: string) => {
      published.push({ channel, message })
      return 1
    }),
    quit: vi.fn(async () => undefined),
    published,
    emit: (message: string) => {
      if (listener) listener(message)
    },
  }

  return client
}

function makeRes() {
  const frames: string[] = []
  const res = {
    write: (chunk: string) => {
      frames.push(chunk)
      return true
    },
    end: () => undefined,
    on: () => res,
  } as any
  return { res, frames }
}

function makeFactory() {
  const created: FakeRedis[] = []
  const factory = (_url: string) => {
    const client = makeFakeRedis()
    created.push(client)
    return client as any
  }
  return { factory, created }
}

function frameCount(frames: string[], channel: string): number {
  return frames.filter(frame => frame.includes(`event: ${channel}`)).length
}

beforeEach(() => {
  __setRealtimeRedisFactoryForTests(null)
})

afterEach(async () => {
  await __resetRealtimeForTests()
  vi.restoreAllMocks()
})

describe('realtime Redis pub/sub fan-out', () => {
  it('delivers locally once and publishes the event for sibling instances', async () => {
    const { factory, created } = makeFactory()
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [RoleName.OWNER] })

    realtime.publish('content.updated', { entity: 'faq' })
    await realtime.__flushForTests()

    expect(frameCount(frames, 'content.updated')).toBe(1)

    const subscriber = created[0]
    const publisher = created[1]
    expect(subscriber.subscribe).toHaveBeenCalledWith('vedhicfoods:realtime', expect.any(Function))
    expect(publisher.publish).toHaveBeenCalledTimes(1)

    const [channel, message] = publisher.publish.mock.calls[0]
    expect(channel).toBe('vedhicfoods:realtime')
    const parsed = JSON.parse(message as string)
    expect(parsed.channel).toBe('content.updated')
    expect(typeof parsed.origin).toBe('string')
  })

  it("ignores the instance's own echo so the origin does not double-deliver", async () => {
    const { factory, created } = makeFactory()
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [RoleName.OWNER] })
    realtime.publish('content.updated', { entity: 'faq' })
    await realtime.__flushForTests()

    const message = created[1].publish.mock.calls[0][1] as string
    created[0].emit(message)

    expect(frameCount(frames, 'content.updated')).toBe(1)
  })

  it('delivers a sibling instance message locally without re-publishing', async () => {
    const { factory, created } = makeFactory()
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [RoleName.OWNER] })
    await realtime.__flushForTests()

    const remote = JSON.stringify({
      origin: 'some-other-instance',
      channel: 'content.updated',
      data: JSON.stringify({ entity: 'testimonial' }),
    })
    created[0].emit(remote)

    expect(frameCount(frames, 'content.updated')).toBe(1)
    expect(created[1].publish).not.toHaveBeenCalled()
  })

  it('keeps identity-based channel filtering intact', async () => {
    const { factory, created } = makeFactory()
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [] })
    // Wait for the subscriber to be connected and listening before emitting.
    await realtime.__flushForTests()

    created[0].emit(JSON.stringify({ origin: 'sibling', channel: 'order.created', data: '{}' }))
    created[0].emit(JSON.stringify({ origin: 'sibling', channel: 'content.updated', data: '{}' }))

    expect(frameCount(frames, 'order.created')).toBe(0)
    expect(frameCount(frames, 'content.updated')).toBe(1)
  })

  it('degrades to local-only delivery when Redis cannot connect', async () => {
    const factory = (_url: string) => {
      const client = makeFakeRedis()
      client.connect = vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      })
      return client as any
    }
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [RoleName.OWNER] })

    expect(() => realtime.publish('content.updated', { entity: 'faq' })).not.toThrow()
    await realtime.__flushForTests()

    expect(frameCount(frames, 'content.updated')).toBe(1)
  })

  it('does not throw when the Redis publish itself fails', async () => {
    const { factory, created } = makeFactory()
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [RoleName.OWNER] })

    // First publish connects and succeeds; then make the Redis publish fail.
    realtime.publish('content.updated', { entity: 'faq' })
    await realtime.__flushForTests()
    created[1].publish.mockRejectedValueOnce(new Error('redis down'))

    expect(() => realtime.publish('content.updated', { entity: 'faq' })).not.toThrow()
    await realtime.__flushForTests()

    expect(frameCount(frames, 'content.updated')).toBe(2)
  })

  it('reports connected client count and clears it on close', async () => {
    const { factory } = makeFactory()
    __setRealtimeRedisFactoryForTests(factory as any)

    const first = makeRes()
    const second = makeRes()
    realtime.subscribe(first.res, { roles: [RoleName.OWNER] })
    realtime.subscribe(second.res, { roles: [RoleName.OWNER] })

    expect(realtime.connectedClients).toBe(2)

    await realtime.close()
    expect(realtime.connectedClients).toBe(0)
  })
})
