import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'

const app = createApp()

describe('API Foundation End-to-End Tests', () => {
  it('should enforce security headers via Helmet', async () => {
    const res = await request(app).get('/api/v1/health')

    expect(res.headers['x-dns-prefetch-control']).toBe('off')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['x-download-options']).toBe('noopen')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('should properly handle CORS options preflight', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })
})
