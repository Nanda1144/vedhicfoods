import './_safety'
import crypto from 'crypto'
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app'
import { prisma } from '../../src/config/database'
import { EmailService, EmailQueue, __setEmailRetryDelayForTests } from '../../src/services/email.service'
import { EmailSuppressionService } from '../../src/integrations/email/email-suppression.service'
import {
  canonicalSnsString,
  __setSnsCertFetcherForTests,
  __resetSnsCertFetcherForTests,
  type SnsEnvelope,
} from '../../src/integrations/email/sns-verifier'
import { env } from '../../src/config/env'
import { captureEmailTransport, type EmailTransportCapture } from './helpers/email-capture'

const app = createApp()
const WEBHOOK = '/api/v1/webhooks/email/sns'

/**
 * Bounce/complaint handling.
 *
 * SES reports hard bounces and complaints through SNS. This suite covers the
 * whole path: signature verification, the suppression list it maintains, and
 * the send-path guard that refuses to deliver to a suppressed address. The SNS
 * signature is produced here with a real RSA key so the verification code
 * executes for real — no "always true" stub.
 */
describe('Email suppression (SES bounce/complaint via SNS)', () => {
  let cap: EmailTransportCapture | undefined
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

  const topicArn = 'arn:aws:sns:ap-south-1:123456789012:vedhicfoods-ses-events'

  function signedEnvelope(event: any, overrides: Partial<SnsEnvelope> = {}): SnsEnvelope {
    const envelope: SnsEnvelope = {
      Type: 'Notification',
      MessageId: `msg-${Math.random().toString(36).slice(2)}`,
      TopicArn: env.SNS_EMAIL_TOPIC_ARN || topicArn,
      Message: JSON.stringify(event),
      Timestamp: new Date().toISOString(),
      SignatureVersion: '2',
      SigningCertURL: 'https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-test.pem',
      ...overrides,
    }
    envelope.Signature = crypto
      .sign('RSA-SHA256', Buffer.from(canonicalSnsString(envelope), 'utf8'), privateKey)
      .toString('base64')
    return envelope
  }

  const bounceEvent = (email: string, bounceType: 'Permanent' | 'Transient') => ({
    eventType: 'Bounce',
    bounce: { bounceType, bouncedRecipients: [{ emailAddress: email }] },
  })
  const complaintEvent = (email: string) => ({
    eventType: 'Complaint',
    complaint: { complainedRecipients: [{ emailAddress: email }] },
  })

  beforeEach(() => {
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
    __setEmailRetryDelayForTests(1)
    EmailSuppressionService.__resetCacheForTests()
    __setSnsCertFetcherForTests(async () => publicPem)
    cap = captureEmailTransport()
  })

  afterEach(() => {
    cap?.restore()
    cap = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    __resetSnsCertFetcherForTests()
    EmailQueue.clearQueue()
    EmailQueue.__resetDedupeForTests()
  })

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: 'email_suppression_list' } }).catch(() => {})
    EmailSuppressionService.__resetCacheForTests()
  })

  it('suppresses a permanent-bounce recipient from a signed SNS notification', async () => {
    const email = `hard.bounce.${Date.now()}@example.com`

    const res = await request(app).post(WEBHOOK).send(signedEnvelope(bounceEvent(email, 'Permanent')))
    expect(res.status).toBe(200)
    expect(res.body.data.suppressed).toBe(1)
    expect(await EmailSuppressionService.isSuppressed(email)).toBe(true)
  })

  it('suppresses a complaint recipient', async () => {
    const email = `complaint.${Date.now()}@example.com`

    const res = await request(app).post(WEBHOOK).send(signedEnvelope(complaintEvent(email)))
    expect(res.status).toBe(200)
    expect(await EmailSuppressionService.isSuppressed(email)).toBe(true)
  })

  it('does NOT suppress a transient bounce', async () => {
    const email = `soft.bounce.${Date.now()}@example.com`

    const res = await request(app).post(WEBHOOK).send(signedEnvelope(bounceEvent(email, 'Transient')))
    expect(res.status).toBe(200)
    expect(res.body.data.suppressed).toBe(0)
    expect(await EmailSuppressionService.isSuppressed(email)).toBe(false)
  })

  it('rejects a tampered notification and suppresses nothing', async () => {
    const email = `tampered.${Date.now()}@example.com`
    const envelope = signedEnvelope(bounceEvent(email, 'Permanent'))
    ;(envelope.Message as string) = JSON.stringify(complaintEvent('attacker@example.com'))

    const res = await request(app).post(WEBHOOK).send(envelope)
    expect(res.status).toBe(403)
    expect((await EmailSuppressionService.list()).some((e) => e.email === email)).toBe(false)
  })

  it('handles the SNS subscription handshake for a trusted URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const subscribeUrl = 'https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc'
    const envelope = signedEnvelope({}, { Type: 'SubscriptionConfirmation', SubscribeURL: subscribeUrl })

    const res = await request(app).post(WEBHOOK).send(envelope)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(subscribeUrl)
  })

  it('skips delivery to a suppressed recipient', async () => {
    const email = `suppressed.send.${Date.now()}@example.com`
    EmailSuppressionService.__seedForTests({ [email]: { reason: 'hard-bounce', at: new Date().toISOString() } })

    const result = await EmailQueue.sendImmediate(email, 'Verification', '<p>verify</p>')
    expect(result).toBe('suppressed')
    expect(cap!.emails).toHaveLength(0)
  })

  it('still delivers to a normal recipient', async () => {
    const email = `normal.send.${Date.now()}@example.com`
    EmailSuppressionService.__seedForTests({})

    await EmailService.sendWelcome({ customerEmail: email, customerName: 'Normal' })
    expect(cap!.to(email)).toHaveLength(1)
  })
})
