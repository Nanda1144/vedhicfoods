import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getEmailProvider, __resetEmailProviderForTests } from '../../src/integrations/email/email-transport'
import { env } from '../../src/config/env'

/**
 * Provider selection and the sandbox/production configuration surface.
 *
 * `EMAIL_PROVIDER` was previously dead configuration: every caller reached
 * `BrevoEmailService` directly, so setting it to `ses` changed nothing. These
 * tests pin the selection rules that decide which transport a deployment
 * actually uses — the setting most likely to be misconfigured during the SES
 * cutover.
 */
describe('Email provider selection', () => {
  const saved = {
    EMAIL_PROVIDER: env.EMAIL_PROVIDER,
    SES_SENDER_EMAIL: env.SES_SENDER_EMAIL,
    NODE_ENV: env.NODE_ENV,
  }

  beforeEach(() => {
    __resetEmailProviderForTests()
  })

  afterEach(() => {
    Object.assign(env, saved)
    __resetEmailProviderForTests()
  })

  it('explicitly selects SES when EMAIL_PROVIDER=ses', () => {
    ;(env as any).EMAIL_PROVIDER = 'ses'
    ;(env as any).SES_SENDER_EMAIL = undefined
    expect(getEmailProvider().name).toBe('ses')
  })

  it('explicitly selects Brevo when EMAIL_PROVIDER=brevo', () => {
    ;(env as any).EMAIL_PROVIDER = 'brevo'
    expect(getEmailProvider().name).toBe('brevo')
  })

  it('auto prefers SES once a sender identity is configured', () => {
    ;(env as any).EMAIL_PROVIDER = 'auto'
    ;(env as any).SES_SENDER_EMAIL = 'noreply@vedhicfoods.com'
    expect(getEmailProvider().name).toBe('ses')
  })

  it('auto falls back to Brevo when SES has no sender identity', () => {
    ;(env as any).EMAIL_PROVIDER = 'auto'
    ;(env as any).SES_SENDER_EMAIL = undefined
    expect(getEmailProvider().name).toBe('brevo')
  })

  it('resolves the transport once and caches the decision', () => {
    ;(env as any).EMAIL_PROVIDER = 'brevo'
    expect(getEmailProvider().name).toBe('brevo')

    ;(env as any).EMAIL_PROVIDER = 'ses'
    expect(getEmailProvider().name).toBe('brevo')

    __resetEmailProviderForTests()
    expect(getEmailProvider().name).toBe('ses')
  })

  it('never reaches a live provider under NODE_ENV=test', () => {
    ;(env as any).EMAIL_PROVIDER = 'ses'
    ;(env as any).SES_SENDER_EMAIL = 'noreply@vedhicfoods.com'
    ;(env as any).NODE_ENV = 'test'
    expect(getEmailProvider().shouldSimulate()).toBe(true)

    __resetEmailProviderForTests()
    ;(env as any).EMAIL_PROVIDER = 'brevo'
    expect(getEmailProvider().shouldSimulate()).toBe(true)
  })
})
