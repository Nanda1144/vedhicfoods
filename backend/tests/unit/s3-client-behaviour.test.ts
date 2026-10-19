/**
 * S3 storage behaviour — real client paths exercised against a mocked transport.
 *
 * The integration suite only reaches the dev/test fallbacks (no AWS credentials
 * are available in CI). These tests stub the SDK transport so the *production*
 * branches — invalid credentials, unavailable bucket, byte-level re-validation,
 * upload metadata, delete/exists — are executed for real without hitting AWS.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HeadObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put?X-Amz-Signature=abc'),
}))

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { S3Service } from '../../src/integrations/aws/s3/s3.service'
import { s3Client } from '../../src/integrations/aws/s3/s3.client'
import { env } from '../../src/config/env'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'utf-8')

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111'
const VALID_KEY = `products/${PRODUCT_ID}/1700000000000-22222222-2222-2222-2222-222222222222.png`

let originalNodeEnv: string

beforeEach(() => {
  originalNodeEnv = env.NODE_ENV
})

afterEach(() => {
  env.NODE_ENV = originalNodeEnv
  vi.restoreAllMocks()
})

describe('S3Service.uploadFile (production storage path)', () => {
  it('stores the object with the validated content-type and inline disposition', async () => {
    const spy = vi.spyOn(s3Client, 'send').mockResolvedValue({} as any)
    const url = await S3Service.uploadFile({ key: VALID_KEY, body: PNG, contentType: 'image/png' })

    expect(url).toBe(S3Service.buildPublicUrl(VALID_KEY))
    const cmd = spy.mock.calls[0][0] as PutObjectCommand
    expect(cmd.input.Key).toBe(VALID_KEY)
    expect(cmd.input.ContentType).toBe('image/png')
    expect(cmd.input.ContentDisposition).toBe('inline')
  })

  it('rejects script-bearing bytes before issuing any S3 request', async () => {
    const spy = vi.spyOn(s3Client, 'send').mockResolvedValue({} as any)
    await expect(
      S3Service.uploadFile({ key: VALID_KEY, body: HTML, contentType: 'image/png' })
    ).rejects.toThrow(/do not match the declared file type/i)
    expect(spy).not.toHaveBeenCalled()
  })

  it('fails closed with a generic message when credentials are invalid in production', async () => {
    env.NODE_ENV = 'production'
    vi.spyOn(s3Client, 'send').mockRejectedValue(
      new Error('The AWS Access Key Id you provided does not exist in our records')
    )
    await expect(
      S3Service.uploadFile({ key: VALID_KEY, body: PNG, contentType: 'image/png' })
    ).rejects.toThrow('Failed to upload image to cloud storage.')
  })

  it('fails closed with a generic message when the production upload times out', async () => {
    env.NODE_ENV = 'production'
    const timeout = Object.assign(new Error('socket timed out'), { name: 'TimeoutError', code: 'ETIMEDOUT' })
    vi.spyOn(s3Client, 'send').mockRejectedValue(timeout)
    await expect(
      S3Service.uploadFile({ key: VALID_KEY, body: PNG, contentType: 'image/png' })
    ).rejects.toThrow('Failed to upload image to cloud storage.')
  })

  it('never leaks the provider error text in the production failure', async () => {
    env.NODE_ENV = 'production'
    vi.spyOn(s3Client, 'send').mockRejectedValue(new Error('AccessKeyId AKIAIOSFODNN7EXAMPLE rejected'))
    try {
      await S3Service.uploadFile({ key: VALID_KEY, body: PNG, contentType: 'image/png' })
      throw new Error('expected upload to reject')
    } catch (err: any) {
      expect(err.message).not.toContain('AKIAIOSFODNN7EXAMPLE')
    }
  })

  it('degrades gracefully outside production when the bucket is unavailable', async () => {
    env.NODE_ENV = 'test'
    vi.spyOn(s3Client, 'send').mockRejectedValue(new Error('getaddrinfo ENOTFOUND bucket'))
    await expect(
      S3Service.uploadFile({ key: VALID_KEY, body: PNG, contentType: 'image/png' })
    ).resolves.toBe(S3Service.buildPublicUrl(VALID_KEY))
  })
})

describe('S3Service.generatePresignedUploadUrl', () => {
  it('returns the signed URL from the presigner in production', async () => {
    env.NODE_ENV = 'production'
    const res = await S3Service.generatePresignedUploadUrl(PRODUCT_ID, 'image/png', 1024)
    expect(res.uploadUrl).toBe('https://signed.example/put?X-Amz-Signature=abc')
    expect(res.s3Key).toMatch(new RegExp(`^products/${PRODUCT_ID}/`))
    expect(res.s3Key.endsWith('.png')).toBe(true)
  })

  it('fails closed with a generic message when signing fails in production', async () => {
    env.NODE_ENV = 'production'
    vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error('SignatureDoesNotMatch'))
    await expect(S3Service.generatePresignedUploadUrl(PRODUCT_ID, 'image/png')).rejects.toThrow(
      'Failed to generate secure upload credentials.'
    )
  })

  it('falls back to a simulated URL outside production when signing fails', async () => {
    env.NODE_ENV = 'test'
    vi.mocked(getSignedUrl).mockRejectedValueOnce(new Error('no credentials'))
    const res = await S3Service.generatePresignedUploadUrl(PRODUCT_ID, 'image/webp')
    expect(res.uploadUrl).toContain('simulated=true')
  })

  it('refuses to mint a key for a disallowed content type', async () => {
    await expect(S3Service.generatePresignedUploadUrl(PRODUCT_ID, 'image/svg+xml')).rejects.toThrow()
  })
})

describe('S3Service.verifyUploadedObject (byte-level re-validation)', () => {
  function headAndGet(contentType: string, bytes: Buffer) {
    return vi.spyOn(s3Client, 'send').mockImplementation(async (command: any) => {
      if (command instanceof HeadObjectCommand) {
        return { ContentType: contentType, ContentLength: bytes.length } as any
      }
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => bytes } } as any
      }
      return {} as any
    })
  }

  it('accepts an object whose stored bytes really are the declared image', async () => {
    env.NODE_ENV = 'production'
    headAndGet('image/png', PNG)
    const res = await S3Service.verifyUploadedObject(VALID_KEY, { expectedProductId: PRODUCT_ID })
    expect(res.contentType).toBe('image/png')
    expect(res.sizeBytes).toBe(PNG.length)
  })

  it('rejects a PNG-declared object whose bytes are HTML (polyglot upload)', async () => {
    env.NODE_ENV = 'production'
    headAndGet('image/png', HTML)
    await expect(
      S3Service.verifyUploadedObject(VALID_KEY, { expectedProductId: PRODUCT_ID })
    ).rejects.toThrow(/do not match the declared file type/i)
  })

  it('rejects an object stored with a disallowed content type', async () => {
    env.NODE_ENV = 'production'
    headAndGet('text/html', HTML)
    await expect(S3Service.verifyUploadedObject(VALID_KEY)).rejects.toThrow(/Unsupported file type/)
  })

  it('rejects a missing object in production', async () => {
    env.NODE_ENV = 'production'
    vi.spyOn(s3Client, 'send').mockRejectedValue(new Error('NotFound'))
    await expect(S3Service.verifyUploadedObject(VALID_KEY)).rejects.toThrow(/could not be found/)
  })

  it('rejects an object minted for a different product', async () => {
    env.NODE_ENV = 'production'
    headAndGet('image/png', PNG)
    await expect(
      S3Service.verifyUploadedObject(VALID_KEY, {
        expectedProductId: '33333333-3333-3333-3333-333333333333',
      })
    ).rejects.toThrow(/does not belong to the requested product/)
  })

  it('refuses a key outside the products/ prefix', async () => {
    env.NODE_ENV = 'production'
    headAndGet('image/png', PNG)
    await expect(S3Service.verifyUploadedObject('invoices/user-1/INV-1.pdf')).rejects.toThrow(
      /outside the products\/ prefix/
    )
  })

  it('refuses a path-traversal key', async () => {
    env.NODE_ENV = 'production'
    headAndGet('image/png', PNG)
    await expect(S3Service.verifyUploadedObject('products/../../etc/passwd')).rejects.toThrow()
  })
})

describe('S3Service.deleteFile and checkObjectExists', () => {
  it('reports a successful production delete', async () => {
    env.NODE_ENV = 'production'
    vi.spyOn(s3Client, 'send').mockResolvedValue({} as any)
    await expect(S3Service.deleteFile(VALID_KEY)).resolves.toBe(true)
  })

  it('reports a failed production delete without throwing', async () => {
    env.NODE_ENV = 'production'
    vi.spyOn(s3Client, 'send').mockRejectedValue(new Error('AccessDenied'))
    await expect(S3Service.deleteFile(VALID_KEY)).resolves.toBe(false)
  })

  it('reports a production S3 request timeout as a failed delete', async () => {
    env.NODE_ENV = 'production'
    const timeout = Object.assign(new Error('socket timed out'), { name: 'TimeoutError', code: 'ETIMEDOUT' })
    vi.spyOn(s3Client, 'send').mockRejectedValue(timeout)
    await expect(S3Service.deleteFile(VALID_KEY)).resolves.toBe(false)
  })

  it('checks object existence using HeadObject', async () => {
    const spy = vi.spyOn(s3Client, 'send').mockResolvedValue({} as any)
    await expect(S3Service.checkObjectExists(VALID_KEY)).resolves.toBe(true)
    expect(spy.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
  })

  it('returns false when the object does not exist', async () => {
    vi.spyOn(s3Client, 'send').mockRejectedValue(new Error('NotFound'))
    await expect(S3Service.checkObjectExists(VALID_KEY)).resolves.toBe(false)
  })
})
