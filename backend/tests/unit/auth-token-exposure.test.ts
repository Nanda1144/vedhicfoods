import { describe, expect, it } from 'vitest'
import { exposeTestToken } from '../../src/controllers/auth.controller'

describe('sensitive auth token response exposure', () => {
  it('allows tokens only in the isolated test environment', () => {
    expect(exposeTestToken('resetToken', 'test-only-token', 'test')).toEqual({
      resetToken: 'test-only-token',
    })
  })

  it.each(['development', 'staging', 'production'])(
    'does not return bearer tokens in %s',
    (environment) => {
      expect(exposeTestToken('resetToken', 'sensitive-token', environment)).toEqual({})
      expect(exposeTestToken('verificationToken', 'sensitive-token', environment)).toEqual({})
    }
  )

  it('does not expose an absent token in tests', () => {
    expect(exposeTestToken('resetToken', undefined, 'test')).toEqual({})
  })
})
