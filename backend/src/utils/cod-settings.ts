import { prisma } from '../config/database'

/**
 * Cash on Delivery is optional and admin-controlled.
 *
 * The storefront must never offer COD until an operator explicitly enables it.
 * The admin console toggles `PaymentSettings.codEnabled`; that write also mirrors
 * the value into the public `shipping_cod_enabled` system setting so the
 * unauthenticated storefront can read the flag. This helper is the single
 * runtime source of truth for the backend checkout gate.
 *
 * Precedence: the public `shipping_cod_enabled` setting wins when present (it is
 * what the storefront sees), falling back to `PaymentSettings.codEnabled`, then
 * to `false`. Defaulting to disabled is deliberate: an unconfigured install must
 * not accept COD.
 */
export async function isCodEnabled(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'shipping_cod_enabled' },
  })

  if (setting) return parseBoolean(setting.value)

  const paymentSettings = await prisma.paymentSettings.findUnique({
    where: { id: 'default' },
    select: { codEnabled: true },
  })

  return paymentSettings?.codEnabled ?? false
}

function parseBoolean(value: string): boolean {
  if (typeof value === 'boolean') return value
  const normalised = String(value).trim().toLowerCase()
  return normalised === 'true' || normalised === '1' || normalised === 'yes'
}
