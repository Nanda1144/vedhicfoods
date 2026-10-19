import { beforeEach, describe, expect, it, vi } from 'vitest'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/config/database', () => ({
  prisma: { auditLog: { create } },
}))
vi.mock('../../src/config/logger', () => ({
  logger: { error: vi.fn() },
}))

import { AuditService } from '../../src/services/audit.service'

describe('AuditService metadata secret protection', () => {
  beforeEach(() => create.mockReset().mockResolvedValue({}))

  it('redacts sensitive keys recursively, including objects inside arrays', async () => {
    await AuditService.record({
      action: 'TEST',
      entity: 'TEST',
      metadata: {
        apiKey: 'api-key-value',
        auth: { username: 'operator', private_key: 'private-key-value' },
        events: [
          { refreshToken: 'refresh-token-value', safeLabel: 'kept' },
          [{ authorization: 'bearer-value', passwordHash: 'password-hash-value' }],
        ],
      },
    })

    const metadata = create.mock.calls[0][0].data.metadata
    expect(metadata).toEqual({
      apiKey: '[REDACTED]',
      auth: { username: 'operator', private_key: '[REDACTED]' },
      events: [
        { refreshToken: '[REDACTED]', safeLabel: 'kept' },
        [{ authorization: '[REDACTED]', passwordHash: '[REDACTED]' }],
      ],
    })
    expect(JSON.stringify(metadata)).not.toMatch(/api-key-value|private-key-value|refresh-token-value|bearer-value|password-hash-value/)
  })
})
