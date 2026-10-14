import { describe, it, expect } from 'vitest'
import { env } from '../../src/config/env'

describe('Environment Configuration Unit Tests', () => {
  it('should load and validate core environment variables', () => {
    expect(env).toBeDefined()
    expect(env.PORT).toBeTypeOf('number')
    expect(env.NODE_ENV).toBeDefined()
    expect(env.DATABASE_URL).toBeDefined()
  })

  it('should enforce minimum length for JWT secret', () => {
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32)
  })

  it('should have default AWS region set to ap-south-1', () => {
    expect(env.AWS_REGION).toBe('ap-south-1')
  })
})
