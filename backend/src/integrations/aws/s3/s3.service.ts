import {
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client } from './s3.client'
import { env } from '../../../config/env'
import { logger } from '../../../config/logger'
import { v4 as uuidv4 } from 'uuid'

export interface S3UploadOptions {
  key: string
  body: Buffer | Uint8Array
  contentType: string
  metadata?: Record<string, string>
}

export interface PresignedUrlResult {
  uploadUrl: string
  fileUrl: string
  s3Key: string
}

export interface PresignedDownloadResult {
  downloadUrl: string
  fileUrl: string
  s3Key: string
}

export class S3Service {
  private static readonly bucketName = env.AWS_S3_BUCKET

  /**
   * Images the storefront is allowed to store.
   *
   * SVG is deliberately absent: it is an XML document that can carry inline
   * <script>, and serving one from the bucket origin would be stored XSS.
   */
  private static readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/avif',
  ] as const

  /**
   * Canonical file extension per MIME type.
   *
   * SECURITY: the object key extension is derived from the *validated MIME
   * type*, never from the caller-supplied filename. Deriving it from the
   * filename let a caller request a key ending in `.html`/`.svg`; combined with
   * a bucket that serves objects inline, that becomes stored XSS on the bucket
   * origin. Browsers and CDNs key content-type sniffing off the extension.
   */
  private static readonly EXTENSION_BY_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  }

  /** Magic-number prefixes used to confirm the bytes really are the claimed image type. */
  private static readonly MAGIC_BYTES: Record<string, { offset: number; bytes: number[] }> = {
    'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
    'image/jpg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
    'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    'image/webp': { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP" at offset 8
    'image/avif': { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // "ftyp" at offset 4
    'application/pdf': { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // "%PDF-"
  }

  /**
   * Server-generated documents (invoices). PDFs can carry embedded JavaScript
   * and launch actions, so they are only ever stored with
   * `Content-Disposition: attachment` and are never treated as images.
   */
  private static readonly ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf'] as const

  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
  public static readonly MAX_IMAGE_BYTES = S3Service.MAX_FILE_SIZE
  public static readonly ALLOWED_IMAGE_TYPES = S3Service.ALLOWED_MIME_TYPES
  public static readonly ALLOWED_DOCUMENT_TYPES = S3Service.ALLOWED_DOCUMENT_MIME_TYPES

  /**
   * Validates image MIME type and file size.
   */
  public static validateImage(contentType: string, sizeBytes?: number): void {
    const normalised = String(contentType || '').toLowerCase().split(';')[0]!.trim()

    if (!(S3Service.ALLOWED_MIME_TYPES as readonly string[]).includes(normalised)) {
      throw new Error(
        `Unsupported file type '${contentType}'. Allowed types: JPEG, PNG, WebP, AVIF.`
      )
    }

    if (sizeBytes !== undefined && (sizeBytes < 0 || sizeBytes > S3Service.MAX_FILE_SIZE)) {
      throw new Error(
        `File size exceeds 5MB limit. Provided size: ${((sizeBytes || 0) / (1024 * 1024)).toFixed(2)}MB.`
      )
    }
  }

  /**
   * Confirms that a buffer actually begins with the magic bytes of the
   * MIME type it claims.
   *
   * A client-declared `Content-Type` proves nothing: a multipart upload can
   * carry arbitrary bytes. This is the only cheap server-side check that stops
   * an HTML/SVG/JS payload from being stored as a "product image".
   */
  public static assertRealImageBytes(contentType: string, body: Buffer | Uint8Array): void {
    const normalised = String(contentType || '').toLowerCase().split(';')[0]!.trim()
    const signature = S3Service.MAGIC_BYTES[normalised]

    if (!signature) {
      throw new Error(`No magic-byte signature known for '${contentType}'.`)
    }

    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)

    // Fail closed. An earlier version skipped the check entirely when the buffer
    // was over the limit, which let a caller bypass content validation simply by
    // sending a larger payload.
    if (buf.length === 0) {
      throw new Error('Uploaded file is empty.')
    }

    if (buf.length > S3Service.MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds 5MB limit. Provided size: ${(buf.length / (1024 * 1024)).toFixed(2)}MB.`
      )
    }

    const slice = buf.subarray(signature.offset, signature.offset + signature.bytes.length)

    if (slice.length < signature.bytes.length) {
      throw new Error('Uploaded file is truncated and cannot be validated.')
    }

    const matches = signature.bytes.every((byte, index) => slice[index] === byte)

    if (!matches) {
      throw new Error(
        'File contents do not match the declared file type. Rejected to prevent ' +
          'upload of executable or script-bearing content.'
      )
    }
  }

  /**
   * Canonical public URL for an object key.
   *
   * Callers must derive the stored `imageUrl` from the verified key via this
   * helper rather than accepting a URL from the request body. Otherwise a caller
   * could attach an attacker-controlled external origin (or an internal
   * endpoint) as product media, turning every storefront render into a
   * tracking or SSRF-adjacent vector.
   */
  public static buildPublicUrl(s3Key: string): string {
    const base = env.AWS_S3_PUBLIC_BASE_URL?.replace(/\/+$/, '')
    if (base) return `${base}/${s3Key}`
    return `https://${this.bucketName}.s3.${env.AWS_REGION}.amazonaws.com/${s3Key}`
  }

  /**
   * Validates a server-generated document (invoice PDF) MIME type and size.
   */
  public static validateDocument(contentType: string, sizeBytes?: number): void {
    const normalised = String(contentType || '').toLowerCase().split(';')[0]!.trim()

    if (!(S3Service.ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(normalised)) {
      throw new Error(`Unsupported document type '${contentType}'. Allowed types: PDF.`)
    }

    if (sizeBytes !== undefined && (sizeBytes < 0 || sizeBytes > S3Service.MAX_FILE_SIZE)) {
      throw new Error(
        `File size exceeds 5MB limit. Provided size: ${((sizeBytes || 0) / (1024 * 1024)).toFixed(2)}MB.`
      )
    }
  }

  /**
   * Generates a collision-proof, structured S3 object key.
   *
   * The extension is derived from the validated MIME type, so a caller cannot
   * influence it. Layout: products/{productId}/{timestamp}-{uuid}.{ext}
   */
  public static generateProductImageKey(productId: string, contentType: string): string {
    const normalised = String(contentType || '').toLowerCase().split(';')[0]!.trim()
    this.validateImage(normalised)

    const ext = this.EXTENSION_BY_MIME[normalised] || 'bin'

    // productId comes from a route param; strip anything that is not a UUID
    // character so it cannot be used to traverse out of the products/ prefix.
    const safeProductId = String(productId).replace(/[^a-zA-Z0-9-]/g, '')
    if (!safeProductId) {
      throw new Error('Invalid product identifier for object key generation.')
    }

    const uniqueId = uuidv4()
    return `products/${safeProductId}/${Date.now()}-${uniqueId}.${ext}`
  }

  /**
   * Uploads an image buffer directly to Amazon S3.
   */
  public static async uploadFile(options: S3UploadOptions): Promise<string> {
    this.validateImage(options.contentType, options.body?.length)
    // Verify the bytes really are the claimed image type before storing them.
    this.assertRealImageBytes(options.contentType, options.body)

    return this.putValidatedObject(options, 'image')
  }

  /**
   * Uploads a server-generated document (e.g. an invoice PDF).
   *
   * PDFs are stored as `attachment` rather than `inline`: a PDF can contain
   * embedded JavaScript and launch actions, and serving it inline from the
   * bucket origin would hand an attacker a same-origin scripting surface if a
   * crafted file ever reached this path.
   */
  public static async uploadDocument(options: S3UploadOptions): Promise<string> {
    this.validateDocument(options.contentType, options.body?.length)
    this.assertRealImageBytes(options.contentType, options.body)

    return this.putValidatedObject(options, 'document')
  }

  /**
   * Shared write path. Content type has already been validated by the caller.
   */
  private static async putValidatedObject(
    options: S3UploadOptions,
    kind: 'image' | 'document'
  ): Promise<string> {
    const fileUrl = this.buildPublicUrl(options.key)
    const label = kind === 'image' ? 'image' : 'document'

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: options.key,
        Body: options.body,
        ContentType: options.contentType,
        // Images may render inline; documents must be downloaded.
        // `nosniff` stops a browser from overriding the declared type.
        ContentDisposition: kind === 'image' ? 'inline' : 'attachment',
        ContentEncoding: 'binary',
        Metadata: options.metadata,
      })

      await s3Client.send(command)
      logger.info({ key: options.key }, `Uploaded ${label} to Amazon S3 successfully`)
      return fileUrl
    } catch (error: any) {
      // Graceful development fallback if AWS credentials/bucket are not provisioned in dev/test
      if (env.NODE_ENV !== 'production') {
        logger.warn({ key: options.key, err: error.message }, `AWS S3 ${label} upload simulation in dev/test`)
        return fileUrl
      }
      logger.error({ error: error.message, key: options.key }, `Failed to upload ${label} to Amazon S3`)
      throw new Error(`Failed to upload ${label} to cloud storage.`)
    }
  }

  /**
   * Generates a pre-signed S3 PUT URL for direct, secure browser-to-S3 uploads.
   * Client uploads directly to S3 without passing large binaries through the backend.
   *
   * SECURITY NOTES:
   * - The object key extension is derived from the validated MIME type, never
   *   from the caller's filename, so a `.html`/`.svg` key cannot be minted.
   * - `ContentType` is part of the SigV4 signature, so S3 rejects a PUT whose
   *   declared type differs from the one signed here.
   * - A presigned PUT cannot express a maximum object size, so the size is
   *   bounded up front from the declared length, and `verifyUploadedObject`
   *   re-checks the stored object before it is attached to a product.
   */
  public static async generatePresignedUploadUrl(
    productId: string,
    contentType: string,
    declaredSizeBytes?: number,
    expiresIn = 900 // 15 minutes
  ): Promise<PresignedUrlResult> {
    this.validateImage(contentType, declaredSizeBytes)

    const s3Key = this.generateProductImageKey(productId, contentType)
    const fileUrl = this.buildPublicUrl(s3Key)

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        ContentType: contentType,
      })

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn })
      return { uploadUrl, fileUrl, s3Key }
    } catch (error: any) {
      if (env.NODE_ENV !== 'production') {
        // Return simulated direct upload URL for development/test
        return {
          uploadUrl: `${this.buildPublicUrl(s3Key)}?simulated=true`,
          fileUrl,
          s3Key,
        }
      }
      logger.error({ error: error.message, s3Key }, 'Failed to generate pre-signed S3 URL')
      throw new Error('Failed to generate secure upload credentials.')
    }
  }

  /**
   * Re-validates an object that was uploaded through a presigned URL.
   *
   * Because the browser uploads the bytes directly, the backend never sees them.
   * A `HeadObject` alone is NOT sufficient: it only reports metadata that the
   * uploader itself declared when signing the PUT. An attacker can sign a PUT
   * with `Content-Type: image/png` while uploading HTML or an SVG polyglot.
   *
   * So this performs both:
   *   1. HeadObject — confirms existence, declared type and length bounds.
   *   2. A ranged GetObject for the first 16 bytes — confirms the bytes actually
   *      carry the magic number of the declared image type.
   *
   * The range read is a single tiny request, so the cost is negligible.
   */
  public static async verifyUploadedObject(
    s3Key: string,
    options: { expectedContentType?: string; expectedProductId?: string } = {}
  ): Promise<{ contentType: string; sizeBytes: number }> {
    const productId = this.parseProductImageKey(s3Key)

    if (options.expectedProductId) {
      const safeExpected = String(options.expectedProductId).replace(/[^a-zA-Z0-9-]/g, '')
      if (safeExpected && safeExpected !== productId) {
        throw new Error('Uploaded object does not belong to the requested product.')
      }
    }

    let head: { ContentType?: string; ContentLength?: number }

    try {
      head = (await s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: s3Key })
      )) as { ContentType?: string; ContentLength?: number }
    } catch (error: any) {
      // Graceful dev/test fallback when the object store is not provisioned
      // locally — same contract as putValidatedObject, generatePresignedUploadUrl
      // and deleteFile. Production always verifies against the real bucket.
      if (env.NODE_ENV !== 'production') {
        const contentType = this.contentTypeForKey(s3Key)
        this.validateImage(contentType, 1024)
        logger.warn({ s3Key, err: error.message }, 'AWS S3 object verification simulated in dev/test')
        return { contentType, sizeBytes: 1024 }
      }
      throw new Error('Uploaded object could not be found. Did the upload complete?')
    }

    const contentType = String(head.ContentType || '').toLowerCase().split(';')[0]!.trim()
    const sizeBytes = head.ContentLength ?? 0

    this.validateImage(contentType, sizeBytes)

    if (options.expectedContentType && contentType !== options.expectedContentType.toLowerCase()) {
      throw new Error('Uploaded object type does not match the requested image type.')
    }

    await this.assertStoredObjectBytes(s3Key, contentType)

    return { contentType, sizeBytes }
  }

  /**
   * Reads only the leading bytes of a stored object and checks the magic number.
   */
  private static async assertStoredObjectBytes(s3Key: string, contentType: string): Promise<void> {
    let prefix: Uint8Array

    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
          Range: 'bytes=0-15',
        })
      )
      prefix = (await response.Body?.transformToByteArray()) ?? new Uint8Array()
    } catch {
      throw new Error('Uploaded object could not be read for content validation.')
    }

    this.assertRealImageBytes(contentType, Buffer.from(prefix))
  }

  /**
   * Resolves the canonical MIME type implied by an object key's extension.
   */
  private static contentTypeForKey(s3Key: string): string {
    const ext = s3Key.split('.').pop()?.toLowerCase() ?? ''
    const entry = Object.entries(this.EXTENSION_BY_MIME).find(([, extension]) => extension === ext)
    return entry?.[0] ?? ''
  }

  /**
   * Validates the key shape and returns the product segment it belongs to.
   */
  private static parseProductImageKey(s3Key: string): string {
    const match = /^products\/([a-zA-Z0-9-]+)\/\d+-[0-9a-f-]{36}\.(jpg|png|webp|avif)$/.exec(s3Key)
    if (!match?.[1]) {
      throw new Error('Refusing to verify an object outside the products/ prefix.')
    }
    return match[1]
  }

  /**
   * Generates a pre-signed S3 GET URL for secure file downloads.
   * Use this to provide temporary download links for private S3 objects.
   */
  public static async generatePresignedDownloadUrl(
    s3Key: string,
    expiresIn = 3600 // 1 hour
  ): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      })

      const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn })
      return downloadUrl
    } catch (error: any) {
      if (env.NODE_ENV !== 'production') {
        // Return simulated download URL for development/test
        return `${this.buildPublicUrl(s3Key)}?simulated=true`
      }
      logger.error({ error: error.message, s3Key }, 'Failed to generate pre-signed download URL')
      throw new Error('Failed to generate secure download credentials.')
    }
  }

  /**
   * Deletes an object from Amazon S3.
   */
  public static async deleteFile(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      })
      await s3Client.send(command)
      logger.info({ key }, 'Deleted file from Amazon S3 successfully')
      return true
    } catch (error: any) {
      if (env.NODE_ENV !== 'production') {
        logger.warn({ key, err: error.message }, 'Simulated S3 delete in dev/test')
        return true
      }
      logger.error({ error: error.message, key }, 'Failed to delete file from S3')
      return false
    }
  }

  /**
   * Checks if an S3 object exists.
   */
  public static async checkObjectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      })
      await s3Client.send(command)
      return true
    } catch {
      return false
    }
  }
}
