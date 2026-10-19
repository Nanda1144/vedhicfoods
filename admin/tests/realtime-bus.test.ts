import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishRealtime, subscribeRealtime } from '@/services/realtimeBus'

/**
 * The bus is what lets a single SSE connection (owned by `AdminLayout`) feed
 * every page that wants to react to order events. Two properties matter: an
 * unsubscribed listener must stop receiving events, and one throwing listener
 * must not prevent the others from being notified or break the stream.
 */

const teardown: Array<() => void> = []

afterEach(() => {
  while (teardown.length > 0) teardown.pop()?.()
})

describe('realtimeBus', () => {
  it('delivers a published event to a subscriber', () => {
    const seen: string[] = []
    teardown.push(subscribeRealtime((event) => seen.push(event.channel)))

    publishRealtime({ channel: 'order.created', data: { orderNumber: 'VF-1' } })

    expect(seen).toEqual(['order.created'])
  })

  it('stops delivering after unsubscribe', () => {
    const seen: string[] = []
    const unsubscribe = subscribeRealtime((event) => seen.push(event.channel))
    unsubscribe()

    publishRealtime({ channel: 'order.created', data: null })

    expect(seen).toEqual([])
  })

  it('keeps other subscribers alive when one throws', () => {
    const before = vi.fn()
    const after = vi.fn()
    teardown.push(subscribeRealtime(before))
    teardown.push(
      subscribeRealtime(() => {
        throw new Error('subscriber blew up')
      }),
    )
    teardown.push(subscribeRealtime(after))

    expect(() => publishRealtime({ channel: 'order.updated', data: {} })).not.toThrow()
    expect(before).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with no subscribers', () => {
    expect(() => publishRealtime({ channel: 'notification.created', data: {} })).not.toThrow()
  })
})
