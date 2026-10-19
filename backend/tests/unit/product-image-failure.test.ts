import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findProduct: vi.fn(),
  findImage: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  deleteFile: vi.fn(),
  publicUrl: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('../../src/config/database', () => ({
  prisma: {
    product: { findUnique: mocks.findProduct },
    productImage: { findFirst: mocks.findImage },
    $transaction: mocks.transaction,
  },
}))
vi.mock('../../src/integrations/aws/s3/s3.service', () => ({
  S3Service: {
    verifyUploadedObject: mocks.verify,
    deleteFile: mocks.deleteFile,
    buildPublicUrl: mocks.publicUrl,
  },
}))
vi.mock('../../src/services/audit.service', () => ({ AuditService: { record: vi.fn() } }))
vi.mock('../../src/utils/cache', () => ({ withCache: vi.fn(), CACHE_TTL_SECONDS: 60 }))
vi.mock('../../src/utils/catalog-cache', () => ({
  invalidateCatalogCaches: vi.fn(),
  productDetailCacheKey: vi.fn(),
  productListCacheKey: vi.fn(),
}))
vi.mock('../../src/config/logger', () => ({ logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() } }))

import { ProductService } from '../../src/services/product.service'
import { ServiceUnavailableError } from '../../src/utils/errors'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'
const IMAGE_ID = '22222222-2222-4222-8222-222222222222'
const KEY = `products/${PRODUCT_ID}/1700000000000-33333333-3333-4333-8333-333333333333.png`

describe('product image cross-store failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteFile.mockResolvedValue(true)
    mocks.verify.mockResolvedValue({ contentType: 'image/png', sizeBytes: 1024 })
    mocks.publicUrl.mockReturnValue(`https://media.example/${KEY}`)
  })

  it('preserves the database image row when S3 deletion fails or times out', async () => {
    mocks.findImage.mockResolvedValue({ id: IMAGE_ID, productId: PRODUCT_ID, s3Key: KEY, isPrimary: true })
    mocks.deleteFile.mockResolvedValue(false)

    await expect(ProductService.deleteImage(PRODUCT_ID, IMAGE_ID)).rejects.toBeInstanceOf(ServiceUnavailableError)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('removes an uploaded object when byte verification rejects it', async () => {
    mocks.findProduct.mockResolvedValue({ id: PRODUCT_ID, images: [] })
    mocks.verify.mockRejectedValue(new Error('Uploaded image exceeds the size limit'))

    await expect(ProductService.addImage(PRODUCT_ID, {
      imageUrl: `https://media.example/${KEY}`,
      s3Key: KEY,
      isPrimary: false,
      displayOrder: 0,
    })).rejects.toThrow('Uploaded image exceeds the size limit')

    expect(mocks.deleteFile).toHaveBeenCalledWith(KEY)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('compensates the S3 upload when the database attachment transaction fails', async () => {
    mocks.findProduct.mockResolvedValue({ id: PRODUCT_ID, images: [] })
    const databaseError = new Error('database write failed')
    mocks.transaction.mockRejectedValue(databaseError)

    await expect(ProductService.addImage(PRODUCT_ID, {
      imageUrl: `https://media.example/${KEY}`,
      s3Key: KEY,
      isPrimary: false,
      displayOrder: 0,
    })).rejects.toBe(databaseError)

    expect(mocks.deleteFile).toHaveBeenCalledWith(KEY)
  })

  it('logs an orphan cleanup failure without disguising the database error', async () => {
    mocks.findProduct.mockResolvedValue({ id: PRODUCT_ID, images: [] })
    const databaseError = new Error('database write failed')
    mocks.transaction.mockRejectedValue(databaseError)
    mocks.deleteFile.mockResolvedValue(false)

    await expect(ProductService.addImage(PRODUCT_ID, {
      imageUrl: `https://media.example/${KEY}`,
      s3Key: KEY,
      isPrimary: false,
      displayOrder: 0,
    })).rejects.toBe(databaseError)
    expect(mocks.logError).toHaveBeenCalledWith(
      { productId: PRODUCT_ID, s3Key: KEY },
      'Failed to clean up product image after the database attach failed',
    )
  })
})
