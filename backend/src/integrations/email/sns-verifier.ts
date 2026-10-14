import crypto from 'crypto'
import { AppError } from '../../utils/errors'
import { ERROR_CODES, HTTP_STATUS } from '../../constants'

/**
 * Verifies the authenticity of an Amazon SNS message.
 *
 * SECURITY: the bounce/complaint webhook is unauthenticated (SNS cannot present
 * a bearer token). Without signature verification anyone who discovers the URL
 * could POST a forged complaint and trick the server into suppressing arbitrary
 * customer addresses — a denial-of-service against the transactional mail
 * system that is trivial to weaponise. The signature is therefore verified over
 * the canonical message string before any suppression action is taken.
 *
 * The signing certificate is fetched from a `SigningCertURL` that must live on
 * an `sns.<region>.amazonaws.com` host, which also closes the SSRF hole that a
 * naive "fetch whatever URL the attacker put in the JSON" implementation opens.
 */

export interface SnsEnvelope {
  Type?: string
  MessageId?: string
  Token?: string
  TopicArn?: string
  Subject?: string
  Message?: string
  SubscribeURL?: string
  Timestamp?: string
  SignatureVersion?: string
  Signature?: string
  SigningCertURL?: string
  [key: string]: unknown
}

const SNS_HOST_PATTERN = /^sns\.[a-z0-9-]+\.amazonaws\.com$/i

export function isAllowedSnsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && SNS_HOST_PATTERN.test(parsed.hostname)
  } catch {
    return false
  }
}

/** The exact field order SNS signs, each followed by a newline. */
const SIGNED_FIELDS: Array<keyof SnsEnvelope> = [
  'Type',
  'MessageId',
  'Token',
  'TopicArn',
  'Message',
  'SubscribeURL',
  'Timestamp',
]

export function canonicalSnsString(message: SnsEnvelope): string {
  let out = ''
  for (const field of SIGNED_FIELDS) {
    const value = message[field]
    if (value !== undefined && value !== null) out += `${field}\n${value}\n`
  }
  return out
}

type CertFetcher = (url: string) => Promise<string>

const defaultCertFetcher: CertFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`SNS signing certificate fetch failed: ${res.status}`)
  return res.text()
}

let certFetcher: CertFetcher = defaultCertFetcher

export function __setSnsCertFetcherForTests(fn: CertFetcher): void {
  certFetcher = fn
}

export function __resetSnsCertFetcherForTests(): void {
  certFetcher = defaultCertFetcher
}

/**
 * Throws an `AppError` (400) when the message is not a verifiable SNS delivery.
 * Returns normally when the signature is valid.
 */
export async function verifySnsMessage(message: SnsEnvelope): Promise<void> {
  const certUrl = message.SigningCertURL
  if (!certUrl || !isAllowedSnsUrl(certUrl)) {
    throw new AppError('Untrusted SNS SigningCertURL', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR)
  }
  if (!message.Signature || !message.SignatureVersion) {
    throw new AppError('SNS message is missing its signature', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR)
  }

  const certificate = await certFetcher(certUrl)
  const algorithm = message.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1'

  const valid = crypto.verify(
    algorithm,
    Buffer.from(canonicalSnsString(message), 'utf8'),
    certificate,
    Buffer.from(message.Signature, 'base64')
  )

  if (!valid) {
    throw new AppError('Invalid SNS message signature', HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR)
  }
}
