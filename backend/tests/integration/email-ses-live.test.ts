import './_safety'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { env } from '../../src/config/env'
import { SesEmailService, __resetSesClientForTests } from '../../src/integrations/ses/ses.service'

/**
 * Amazon SES LIVE sandbox suite — BLOCKED until real AWS credentials exist.
 *
 * This suite makes *real* SendEmail / SendRawEmail calls and is therefore only
 * permitted to run against an owner-supplied SES sandbox identity. It is gated
 * on `LIVE_SES=true` plus a configured sender and usable AWS credentials; while
 * those are absent every case is reported as skipped rather than faked.
 *
 * The report test below always runs so `vitest` output states exactly what is
 * missing, instead of the suite silently vanishing.
 *
 * To enable locally:
 *   $env:LIVE_SES='true'
 *   $env:SES_SENDER_EMAIL='noreply@<verified-domain>'
 *   $env:AWS_ACCESS_KEY_ID='...'; $env:AWS_SECRET_ACCESS_KEY='...'; $env:SES_REGION='ap-south-1'
 */
const SES_SENDER = env.SES_SENDER_EMAIL
const AWS_CREDS_PRESENT =
  Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
  Boolean(process.env.AWS_PROFILE)

export const SES_READINESS = (() => {
  const blockers: string[] = []
  if (process.env.LIVE_SES !== 'true') blockers.push('LIVE_SES is not "true"')
  if (!SES_SENDER) blockers.push('SES_SENDER_EMAIL is not set')
  if (!AWS_CREDS_PRESENT) blockers.push('No AWS credentials in the environment')
  return {
    ready: blockers.length === 0,
    blockers,
    sender: SES_SENDER,
    region: env.SES_REGION || env.AWS_REGION,
  }
})()

const LIVE_SES = SES_READINESS.ready

describe('SES live readiness', () => {
  it('reports whether the live sandbox gateway is reachable', () => {
    if (LIVE_SES) {
      expect(SES_READINESS.ready).toBe(true)
    } else {
      expect(SES_READINESS.blockers.length).toBeGreaterThan(0)
      // Make the gate visible in CI logs instead of an unexplained skip.
      // eslint-disable-next-line no-console
      console.warn(`[ses-live] BLOCKED: ${SES_READINESS.blockers.join('; ')}`)
    }
  })
})

describe.skipIf(!LIVE_SES)('SES live sandbox — authenticated sends', () => {
  beforeAll(() => {
    // Real send path: bypass the test-mode simulation and use the real client.
    ;(env as any).NODE_ENV = 'production'
    __resetSesClientForTests()
  })

  afterAll(() => {
    ;(env as any).NODE_ENV = 'test'
    __resetSesClientForTests()
  })

  it('delivers a plain transactional email through SES', async () => {
    const id = await SesEmailService.instance.sendTransactionalEmail({
      to: SES_SENDER!,
      subject: 'Vedhic Foods — SES live transport check',
      htmlContent: '<p>Live SES transport verification.</p>',
      textContent: 'Live SES transport verification.',
    })
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('delivers an email with a raw-MIME PDF attachment through SES', async () => {
    const ok = await SesEmailService.instance.sendAttachmentEmail({
      toEmail: SES_SENDER!,
      toName: 'Vedhic Foods QA',
      subject: 'Vedhic Foods — SES live attachment check',
      htmlContent: '<p>Live attachment verification.</p>',
      attachment: {
        name: 'live-check.pdf',
        content: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8').toString('base64'),
      },
    })
    expect(ok).toBe(true)
  })
})
