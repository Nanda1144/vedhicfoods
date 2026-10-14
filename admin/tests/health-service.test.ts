import { describe, expect, it } from 'vitest'
import { formatUptime } from '@/services/healthService'

/**
 * `formatUptime` is the only part of the backend-connection panel that is pure, so
 * it is the only part worth asserting directly. It matters more than it looks: the
 * panel uses server uptime as the signal that an ECS task is crash-looping. An
 * operator seeing "2s" knows to check the task; seeing "unknown" sends them to the
 * wrong place.
 *
 * `null` is a real return, not a defensive branch — the field is absent whenever the
 * probe hits an error response or a proxy that returns no body, so it has to render
 * as something honest instead of "0s", which would read as a task that just started.
 */
describe('formatUptime', () => {
  it('formats sub-minute durations in seconds', () => {
    expect(formatUptime(0)).toBe('0s')
    expect(formatUptime(7)).toBe('7s')
    expect(formatUptime(59)).toBe('59s')
  })

  it('formats minutes, dropping the seconds remainder', () => {
    expect(formatUptime(60)).toBe('1m 0s')
    expect(formatUptime(125)).toBe('2m 5s')
    expect(formatUptime(3599)).toBe('59m 59s')
  })

  it('formats hours, dropping the minutes remainder', () => {
    expect(formatUptime(3600)).toBe('1h 0m')
    expect(formatUptime(7325)).toBe('2h 2m')
  })

  it('formats days once the task has been up for more than a day', () => {
    expect(formatUptime(86_400)).toBe('1d 0h')
    expect(formatUptime(176_400)).toBe('2d 1h')
  })

  it('reports unknown rather than zero when uptime is unavailable', () => {
    expect(formatUptime(null)).toBe('unknown')
    expect(formatUptime(Number.NaN)).toBe('unknown')
    expect(formatUptime(Number.POSITIVE_INFINITY)).toBe('unknown')
  })
})