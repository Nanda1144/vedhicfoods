import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RoleName } from '@prisma/client'

/**
 * The realtime hub must behave exactly as its original in-memory self when no
 * `REDIS_URL` is configured (local development, test, CI): local clients receive
 * events and no Redis client is ever created. `REDIS_URL` is mocked as empty so
 * this holds even if the machine running the suite has one set.
 */
vi.mock('../../src/config/env', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/env')>('../../src/config/env')
  return {
    ...actual,
    env: {
      ...actual.env,
      NODE_ENV: 'test',
      REDIS_URL: '',
    },
  }
})

import {
  realtime,
  __setRealtimeRedisFactoryForTests,
  __resetRealtimeForTests,
} from '../../src/events/realtime'

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

beforeEach(() => {
  __setRealtimeRedisFactoryForTests(null)
})

afterEach(async () => {
  await __resetRealtimeForTests()
  vi.restoreAllMocks()
})

describe('realtime hub without REDIS_URL', () => {
  it('never creates a Redis client and still delivers locally', async () => {
    const factory = vi.fn()
    __setRealtimeRedisFactoryForTests(factory as any)

    const { res, frames } = makeRes()
    realtime.subscribe(res, { roles: [RoleName.OWNER] })

    realtime.publish('content.updated', { entity: 'faq' })
    await realtime.__flushForTests()

    expect(factory).not.toHaveBeenCalled()
    expect(frames.filter(frame => frame.includes('event: content.updated'))).toHaveLength(1)
  })

  it('filters channels by identity', () => {
    const staff = makeRes()
    const guest = makeRes()

    realtime.subscribe(staff.res, { roles: [RoleName.STAFF] })
    realtime.subscribe(guest.res, { roles: [] })

    realtime.publish('order.created', { id: 'order_1' })
    realtime.publish('content.updated', { entity: 'faq' })

    expect(staff.frames.filter(frame => frame.includes('event: order.created'))).toHaveLength(1)
    expect(staff.frames.filter(frame => frame.includes('event: content.updated'))).toHaveLength(1)
    expect(guest.frames.filter(frame => frame.includes('event: order.created'))).toHaveLength(0)
    expect(guest.frames.filter(frame => frame.includes('event: content.updated'))).toHaveLength(1)
  })
})
