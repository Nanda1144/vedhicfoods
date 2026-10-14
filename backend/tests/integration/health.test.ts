import './_safety'
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'

const app = createApp()

describe('Health & Readiness Endpoints Integration Tests', () => {
  it('GET /api/v1/health should return 200 with service health info', async () => {
    const res = await request(app).get('/api/v1/health')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.service).toBe('vedhicfoods-backend')
    expect(res.body.data.status).toBe('healthy')
    expect(res.body.data.timestamp).toBeDefined()
    expect(res.body.data.uptimeSeconds).toBeTypeOf('number')
  })

  it('should attach x-request-id header to response', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-request-id']).toBeDefined()
  })

  it('GET /api/v1/health/ready should respond with readiness check structure', async () => {
    const res = await request(app).get('/api/v1/health/ready')

    expect([200, 503]).toContain(res.status)
    expect(res.body.data).toBeDefined()
    expect(res.body.data.checks).toBeDefined()
    expect(res.body.data.checks.database).toMatch(/connected|disconnected/)
  }, 15000)

  it('GET /non-existent-route should return 404 in standard error format', async () => {
    const res = await request(app).get('/api/v1/non-existent-route')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.code || res.body.error).toBeDefined()
  })
})
