import { PaymentSettings, SettingCategory } from '@prisma/client'
import {
  decryptPaymentSecret,
  encryptPaymentSecret,
  isPaymentEncryptionKeyAvailable,
  maskSecret,
} from 'vedhicfoods-database'
import { prisma } from '../config/database'
import { env, isPlaceholderRazorpayCredential } from '../config/env'
import { logger } from '../config/logger'
import { resolveRazorpayCredentials, clearRazorpayCredentialCache } from '../integrations/razorpay/razorpay.client'
import { AuditService } from './audit.service'
import { BadRequestError, ServiceUnavailableError, ValidationError } from '../utils/errors'

export const ONLINE_PAYMENT_METHODS = ['razorpay', 'upi', 'card', 'netbanking'] as const
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number]

export type PaymentConfigurationState =
  | 'disabled'
  | 'incomplete'
  | 'ready_test'
  | 'ready_live'

export interface PaymentSettingsInput {
  razorpayKeyId?: string
  razorpayKeySecret?: string
  razorpayKeySecretMasked?: string
  webhookSecret?: string
  webhookSecretMasked?: string
  enabledMethods?: string[]
  onlineEnabled?: boolean
  testMode?: boolean
  codEnabled?: boolean
  codLimit?: number
}

export interface PublicPaymentConfig {
  onlineEnabled: boolean
  configured: boolean
  testMode: boolean
  enabledMethods: string[]
  codEnabled: boolean
  codLimit: number
}

const DEFAULT_METHODS = [...ONLINE_PAYMENT_METHODS]
const DEFAULT_COD_LIMIT = 5000
const MASK_CHARACTERS = ['\u2022', '*']

function normaliseMethods(methods: unknown, fallback: string[]): string[] {
  if (!Array.isArray(methods)) return fallback
  const normalised = methods
    .filter((method): method is string => typeof method === 'string')
    .map((method) => method.trim().toLowerCase())
    .filter((method): method is OnlinePaymentMethod =>
      (ONLINE_PAYMENT_METHODS as readonly string[]).includes(method)
    )
  return Array.from(new Set(normalised))
}

function isMaskedInput(value: string): boolean {
  return MASK_CHARACTERS.some((character) => value.includes(character))
}

function normaliseKeyId(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function keyIdMode(keyId: string): 'test' | 'live' | 'unknown' {
  const normalised = keyId.trim().toLowerCase()
  if (normalised.startsWith('rzp_test_')) return 'test'
  if (normalised.startsWith('rzp_live_')) return 'live'
  return 'unknown'
}

function assertModeMatchesKeyId(keyId: string, testMode: boolean): void {
  const mode = keyIdMode(keyId)
  if (mode === 'unknown') return
  if (mode === 'test' && !testMode) {
    throw new ValidationError(
      'A test key (rzp_test_*) cannot be used while Live mode is selected. ' +
        'Switch to Test mode or enter a live key.'
    )
  }
  if (mode === 'live' && testMode) {
    throw new ValidationError(
      'A live key (rzp_live_*) cannot be used while Test mode is selected. ' +
        'Switch to Live mode or enter a test key.'
    )
  }
}

function isUsableCredential(value: string): boolean {
  if (!value.trim()) return false
  if (env.NODE_ENV === 'production' && isPlaceholderRazorpayCredential(value)) return false
  return true
}

function decryptSecret(
  encrypted: string | null | undefined,
  field: 'razorpayKeySecret' | 'webhookSecret'
): { value: string; error: string | null } {
  if (!encrypted) return { value: '', error: null }
  try {
    return { value: decryptPaymentSecret(encrypted, field), error: null }
  } catch (error: any) {
    return {
      value: '',
      error:
        error?.message ||
        'Stored credentials could not be decrypted. Check the payment encryption key.',
    }
  }
}

/**
 * Owns the admin-managed Razorpay configuration and the read model the storefront
 * is allowed to see. Secrets are encrypted with the dedicated payment key and
 * bound to their field via AES-GCM additional authenticated data.
 */
export class PaymentSettingsService {
  private static async findSettings(): Promise<PaymentSettings | null> {
    return prisma.paymentSettings.findUnique({ where: { id: 'default' } })
  }

  private static async actorDetails(actorId: string | null): Promise<{
    updatedByName: string | null
    updatedByEmail: string | null
  }> {
    if (!actorId) return { updatedByName: null, updatedByEmail: null }
    try {
      const user = await prisma.user.findUnique({
        where: { id: actorId },
        select: { fullName: true, email: true },
      })
      return {
        updatedByName: user?.fullName ?? null,
        updatedByEmail: user?.email ?? null,
      }
    } catch {
      return { updatedByName: null, updatedByEmail: null }
    }
  }

  private static configurationState(
    settings: PaymentSettings | null,
    keyConfigured: boolean
  ): PaymentConfigurationState {
    if (!settings?.onlineEnabled) return 'disabled'
    if (!keyConfigured) return 'incomplete'
    return settings.testMode ? 'ready_test' : 'ready_live'
  }

  public static async getAdminSettings(): Promise<Record<string, unknown>> {
    const settings = await this.findSettings()

    if (!settings) {
      return {
        id: null,
        provider: 'razorpay',
        configured: false,
        webhookConfigured: false,
        onlineEnabled: false,
        configurationState: 'disabled',
        keyIdMode: 'unknown',
        razorpayKeyId: '',
        razorpayKeySecretMasked: '',
        webhookSecretMasked: '',
        hasKeySecret: false,
        hasWebhookSecret: false,
        enabledMethods: DEFAULT_METHODS,
        testMode: true,
        codEnabled: true,
        codLimit: DEFAULT_COD_LIMIT,
        updatedAt: null,
        updatedBy: null,
        updatedByName: null,
        updatedByEmail: null,
        encryptionKeyConfigured: isPaymentEncryptionKeyAvailable(),
        credentialError: null,
        message:
          'Payment gateway is not configured. Add the Razorpay key id, key secret ' +
          'and webhook secret, then enable online payments.',
      }
    }

    const keySecret = decryptSecret(settings.encryptedKeySecret, 'razorpayKeySecret')
    const webhookSecret = decryptSecret(settings.encryptedWebhookSecret, 'webhookSecret')
    const actor = await this.actorDetails(settings.updatedBy)
    const keyConfigured =
      Boolean(settings.razorpayKeyId && settings.encryptedKeySecret) &&
      isUsableCredential(settings.razorpayKeyId) &&
      isUsableCredential(keySecret.value)
    const webhookConfigured = Boolean(settings.encryptedWebhookSecret && webhookSecret.value)

    return {
      id: settings.id,
      provider: settings.provider,
      configured: keyConfigured,
      webhookConfigured,
      onlineEnabled: settings.onlineEnabled,
      configurationState: this.configurationState(settings, keyConfigured),
      keyIdMode: keyIdMode(settings.razorpayKeyId),
      razorpayKeyId: settings.razorpayKeyId,
      razorpayKeySecretMasked: keySecret.value ? maskSecret(keySecret.value) : '',
      webhookSecretMasked: webhookSecret.value ? maskSecret(webhookSecret.value) : '',
      hasKeySecret: Boolean(settings.encryptedKeySecret),
      hasWebhookSecret: Boolean(settings.encryptedWebhookSecret),
      enabledMethods: settings.enabledMethods,
      testMode: settings.testMode,
      codEnabled: settings.codEnabled,
      codLimit: settings.codLimit,
      updatedAt: settings.updatedAt.toISOString(),
      updatedBy: settings.updatedBy,
      updatedByName: actor.updatedByName,
      updatedByEmail: actor.updatedByEmail,
      encryptionKeyConfigured: isPaymentEncryptionKeyAvailable(),
      credentialError: keySecret.error || webhookSecret.error,
    }
  }

  public static async updateSettings(
    input: PaymentSettingsInput,
    actorId: string
  ): Promise<Record<string, unknown>> {
    const existing = await this.findSettings()

    const keyId = normaliseKeyId(input.razorpayKeyId, existing?.razorpayKeyId ?? '')
    const testMode =
      typeof input.testMode === 'boolean' ? input.testMode : existing?.testMode ?? true
    // Backwards-compatible default: a legacy client that saves credentials
    // without the new toggle is configuring the gateway, so keep it reachable.
    // The console always sends the explicit switch, including `false`.
    const onlineEnabled =
      typeof input.onlineEnabled === 'boolean'
        ? input.onlineEnabled
        : existing?.onlineEnabled ?? true

    assertModeMatchesKeyId(keyId, testMode)

    if (onlineEnabled && !keyId) {
      throw new ValidationError('Add a Razorpay key id before enabling online payments.')
    }

    const keySecretInput = input.razorpayKeySecret ?? input.razorpayKeySecretMasked
    const webhookSecretInput = input.webhookSecret ?? input.webhookSecretMasked

    let encryptedKeySecret = existing?.encryptedKeySecret ?? ''
    const keySecretRotation =
      typeof keySecretInput === 'string' &&
      keySecretInput.trim().length > 0 &&
      !isMaskedInput(keySecretInput)
    if (keySecretRotation) {
      encryptedKeySecret = this.encryptSecretOrThrow(
        keySecretInput.trim(),
        'razorpayKeySecret'
      )
    }

    let encryptedWebhookSecret = existing?.encryptedWebhookSecret ?? ''
    const webhookSecretRotation =
      typeof webhookSecretInput === 'string' &&
      webhookSecretInput.trim().length > 0 &&
      !isMaskedInput(webhookSecretInput)
    if (webhookSecretRotation) {
      encryptedWebhookSecret = this.encryptSecretOrThrow(
        webhookSecretInput.trim(),
        'webhookSecret'
      )
    }

    // Transparently migrate legacy (three-part) ciphertexts to the dedicated
    // payment key when it is available and no rotation already wrote v2.
    if (!keySecretRotation && existing?.encryptedKeySecret && isPaymentEncryptionKeyAvailable()) {
      const legacy = decryptSecret(existing.encryptedKeySecret, 'razorpayKeySecret')
      if (!legacy.error && legacy.value && !existing.encryptedKeySecret.startsWith('v2:')) {
        encryptedKeySecret = this.encryptSecretOrThrow(legacy.value, 'razorpayKeySecret')
      }
    }
    if (
      !webhookSecretRotation &&
      existing?.encryptedWebhookSecret &&
      isPaymentEncryptionKeyAvailable()
    ) {
      const legacy = decryptSecret(existing.encryptedWebhookSecret, 'webhookSecret')
      if (!legacy.error && legacy.value && !existing.encryptedWebhookSecret.startsWith('v2:')) {
        encryptedWebhookSecret = this.encryptSecretOrThrow(legacy.value, 'webhookSecret')
      }
    }

    if (onlineEnabled && !encryptedKeySecret) {
      throw new ValidationError('Add the Razorpay key secret before enabling online payments.')
    }

    const enabledMethods = normaliseMethods(
      input.enabledMethods,
      existing?.enabledMethods ?? DEFAULT_METHODS
    )
    if (onlineEnabled && enabledMethods.length === 0) {
      throw new ValidationError('Enable at least one online payment method.')
    }

    const codEnabled =
      typeof input.codEnabled === 'boolean' ? input.codEnabled : existing?.codEnabled ?? true
    const codLimit =
      typeof input.codLimit === 'number' && Number.isFinite(input.codLimit) && input.codLimit >= 0
        ? input.codLimit
        : existing?.codLimit ?? DEFAULT_COD_LIMIT

    const updated = await prisma.paymentSettings.upsert({
      where: { id: 'default' },
      update: {
        razorpayKeyId: keyId,
        encryptedKeySecret,
        encryptedWebhookSecret,
        enabledMethods,
        onlineEnabled,
        testMode,
        codEnabled,
        codLimit,
        updatedBy: actorId,
      },
      create: {
        id: 'default',
        provider: 'razorpay',
        razorpayKeyId: keyId,
        encryptedKeySecret,
        encryptedWebhookSecret,
        enabledMethods,
        onlineEnabled,
        testMode,
        codEnabled,
        codLimit,
        updatedBy: actorId,
      },
    })

    // Keep the public COD toggle aligned with the gateway settings.
    await prisma.systemSetting.upsert({
      where: { key: 'shipping_cod_enabled' },
      update: {
        value: String(updated.codEnabled),
        isPublic: true,
        updatedBy: actorId,
      },
      create: {
        key: 'shipping_cod_enabled',
        value: String(updated.codEnabled),
        category: SettingCategory.SHIPPING,
        description: 'Whether Cash on Delivery is offered at storefront checkout',
        isPublic: true,
        updatedBy: actorId,
      },
    })

    const keySecret = decryptSecret(updated.encryptedKeySecret, 'razorpayKeySecret')
    const webhookSecret = decryptSecret(updated.encryptedWebhookSecret, 'webhookSecret')
    const actor = await this.actorDetails(actorId)
    const keyConfigured =
      Boolean(updated.razorpayKeyId && updated.encryptedKeySecret) &&
      isUsableCredential(updated.razorpayKeyId) &&
      isUsableCredential(keySecret.value)
    const webhookConfigured = Boolean(
      updated.encryptedWebhookSecret && webhookSecret.value
    )

    logger.info(
      {
        actorId,
        onlineEnabled: updated.onlineEnabled,
        testMode: updated.testMode,
        enabledMethods: updated.enabledMethods,
      },
      'Payment gateway settings updated'
    )

    clearRazorpayCredentialCache()

    try {
      await AuditService.record({
        action: 'PAYMENT_SETTINGS_UPDATED',
        entity: 'PaymentSettings',
        entityId: updated.id,
        actorId,
        metadata: {
          provider: updated.provider,
          onlineEnabled: updated.onlineEnabled,
          testMode: updated.testMode,
          keyIdMode: keyIdMode(updated.razorpayKeyId),
          enabledMethods: updated.enabledMethods,
          codEnabled: updated.codEnabled,
          codLimit: updated.codLimit,
          keySecretRotated: keySecretRotation,
          webhookSecretRotated: webhookSecretRotation,
        },
      })
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Failed to audit payment settings update')
    }

    return {
      id: updated.id,
      provider: updated.provider,
      configured: keyConfigured,
      webhookConfigured,
      onlineEnabled: updated.onlineEnabled,
      configurationState: this.configurationState(updated, keyConfigured),
      keyIdMode: keyIdMode(updated.razorpayKeyId),
      razorpayKeyId: updated.razorpayKeyId,
      razorpayKeySecretMasked: keySecret.value ? maskSecret(keySecret.value) : '',
      webhookSecretMasked: webhookSecret.value ? maskSecret(webhookSecret.value) : '',
      hasKeySecret: Boolean(updated.encryptedKeySecret),
      hasWebhookSecret: Boolean(updated.encryptedWebhookSecret),
      enabledMethods: updated.enabledMethods,
      testMode: updated.testMode,
      codEnabled: updated.codEnabled,
      codLimit: updated.codLimit,
      updatedAt: updated.updatedAt.toISOString(),
      updatedBy: updated.updatedBy,
      updatedByName: actor.updatedByName,
      updatedByEmail: actor.updatedByEmail,
      encryptionKeyConfigured: isPaymentEncryptionKeyAvailable(),
      credentialError: keySecret.error || webhookSecret.error,
    }
  }

  private static encryptSecretOrThrow(
    plainText: string,
    field: 'razorpayKeySecret' | 'webhookSecret'
  ): string {
    try {
      return encryptPaymentSecret(plainText, field)
    } catch (error: any) {
      throw new ValidationError(
        error?.message ||
          'Payment credential encryption is not configured. Set PAYMENT_CREDENTIALS_ENCRYPTION_KEY.'
      )
    }
  }

  public static async getPublicConfig(): Promise<PublicPaymentConfig> {
    const [settings, codSetting] = await Promise.all([
      this.findSettings(),
      prisma.systemSetting.findUnique({ where: { key: 'shipping_cod_enabled' } }),
    ])

    let session: Awaited<ReturnType<typeof resolveRazorpayCredentials>> | null = null
    try {
      session = await resolveRazorpayCredentials()
    } catch (error: any) {
      logger.error({ error: error?.message }, 'Failed to resolve public payment configuration')
    }

    const methods = normaliseMethods(
      session?.enabledMethods ?? settings?.enabledMethods,
      DEFAULT_METHODS
    )
    const configured = Boolean(session?.configured)
    const onlineEnabled = Boolean(
      session?.onlineEnabled && configured && methods.length > 0
    )

    const codFromRegistry =
      codSetting?.value === undefined ? undefined : String(codSetting.value).toLowerCase()
    const codEnabled =
      codFromRegistry === 'true' || codFromRegistry === '1' || codFromRegistry === 'yes'
        ? true
        : codFromRegistry === 'false' || codFromRegistry === '0' || codFromRegistry === 'no'
          ? false
          : settings?.codEnabled ?? true

    return {
      onlineEnabled,
      configured,
      testMode: session?.testMode ?? settings?.testMode ?? true,
      enabledMethods: methods,
      codEnabled,
      codLimit: settings?.codLimit ?? DEFAULT_COD_LIMIT,
    }
  }

  /**
   * Hard server-side gate for checkout and payment initiation. The storefront
   * hides unavailable options, but a crafted request must still be refused
   * before an order/inventory reservation is created.
   */
  public static async assertOnlinePaymentAllowed(method: string): Promise<void> {
    const normalised = method.trim().toLowerCase()
    if (normalised === 'cod') return

    const config = await this.getPublicConfig()

    if (!config.onlineEnabled) {
      throw new ServiceUnavailableError(
        'Online payments are currently unavailable. Please choose Cash on Delivery or try again later.'
      )
    }
    if (!(ONLINE_PAYMENT_METHODS as readonly string[]).includes(normalised)) {
      throw new BadRequestError('Unsupported online payment method.')
    }
    if (!config.enabledMethods.includes(normalised)) {
      throw new BadRequestError(
        'The selected online payment method is currently unavailable. Please choose another method.'
      )
    }
  }

  /**
   * Verifies the saved key pair against Razorpay without creating a charge. A
   * paginated order list is a read-only authenticated call.
   */
  public static async testConnection(): Promise<Record<string, unknown>> {
    const session = await resolveRazorpayCredentials(true)
    if (!session.configured) {
      throw new ValidationError(
        'Save a Razorpay key id and key secret before testing the connection.'
      )
    }

    try {
      const ordersApi = session.client.orders as unknown as {
        all?: (params: Record<string, unknown>) => Promise<unknown>
      }
      if (typeof ordersApi.all !== 'function') {
        throw new Error('Razorpay SDK does not expose the order list endpoint.')
      }
      await ordersApi.all({ count: 1 })
    } catch (error: any) {
      logger.warn(
        { error: error?.message, keyIdMode: keyIdMode(session.keyId) },
        'Razorpay connection test failed'
      )
      throw new BadRequestError(
        'Razorpay rejected the connection test. Check the key id, key secret and test/live mode.'
      )
    }

    return {
      success: true,
      message: 'Razorpay credentials are valid.',
      testMode: session.testMode,
      keyIdMode: keyIdMode(session.keyId),
      webhookSecretConfigured: Boolean(session.webhookSecret),
      testedAt: new Date().toISOString(),
    }
  }
}
