import type { BrandSettings, PaymentGatewaySettings } from '@/types'

/** Safe, public-only Razorpay placeholder. Never put secret/API keys here. */
export const DEFAULT_PAYMENT_GATEWAY: PaymentGatewaySettings = {
  provider: 'razorpay',
  razorpayKeyId: 'rzp_test_xxxxxxxxxxxxxxxx', // public key (safe to ship)
  razorpayKeySecretMasked: '••••••••••••',
  webhookSecretMasked: '••••••••••••',
  enabledMethods: ['razorpay', 'upi', 'card', 'netbanking'],
  testMode: true,
  codEnabled: true,
  codLimit: 5000,
}

export const DEFAULT_BRAND: BrandSettings = {
  logoUrl: '',
  logoName: 'Vedhi Foods',
  themePreset: 'forest',
  primary: '#1f3d2b',
  secondary: '#6b7b3a',
  accent: '#c9a24b',
  background: '#f6f1e6',
}