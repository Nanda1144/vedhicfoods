import { apiFetch, type RequestOptions } from './http'

/**
 * Razorpay payment orchestration.
 *
 * The storefront never touches the Razorpay secret key or creates amounts — it
 * asks `POST /payments/razorpay/order {orderId}` for a gateway order, opens the
 * Razorpay checkout with the public key that response carries, and hands the
 * resulting `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` back
 * to `POST /payments/razorpay/verify` for HMAC verification server-side.
 */

const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance
  }
}

interface RazorpayCheckoutOptions {
  key: string
  amount: number
  currency: string
  name: string
  description?: string
  order_id: string
  image?: string
  prefill?: { name?: string; email?: string; contact?: string }
  theme?: { color?: string }
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void
  modal?: {
    ondismiss?: () => void
  }
  readonly?: Record<string, unknown>
}

interface RazorpayCheckoutInstance {
  open: () => void
  close: () => void
}

export interface RazorpayInit {
  orderId: string
  orderNumber: string
  razorpayOrderId: string
  amountInPaise: number
  currency: string
  keyId: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  description?: string
}

export interface PaymentVerification {
  success: boolean
  orderId: string
  orderNumber: string
  paymentId: string
  status: string
  verifiedAt: string
}

export interface PaymentStatusResult {
  orderId: string
  orderNumber: string
  orderStatus: string
  paymentStatus: string
  paymentMethod: string
  amount: number
  currency: string
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  verifiedAt: string | null
}

let scriptPromise: Promise<void> | null = null

/** Injects the Razorpay checkout SDK exactly once. */
export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Razorpay requires a browser.'))
  if (window.Razorpay) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SCRIPT_SRC}"]`,
    )
    const script = existing ?? document.createElement('script')
    if (!existing) {
      script.src = CHECKOUT_SCRIPT_SRC
      script.async = true
    }
    const onLoad = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      if (window.Razorpay) resolve()
      else reject(new Error('Razorpay checkout failed to initialise.'))
    }
    const onError = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      scriptPromise = null
      reject(new Error('Could not load Razorpay. Check your connection and try again.'))
    }
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.head.appendChild(script)
  })
  return scriptPromise
}

export const paymentService = {
  /** Creates the gateway order; amount/currency come from the database. */
  createRazorpayOrder(orderId: string, options?: RequestOptions): Promise<RazorpayInit> {
    return apiFetch<RazorpayInit>(
      '/payments/razorpay/order',
      { method: 'POST', body: JSON.stringify({ orderId }) },
      options,
    )
  },

  /** Server-side HMAC verification of the Razorpay signature. */
  verify(
    payload: {
      razorpayOrderId: string
      razorpayPaymentId: string
      razorpaySignature: string
    },
    options?: RequestOptions,
  ): Promise<PaymentVerification> {
    return apiFetch<PaymentVerification>(
      '/payments/razorpay/verify',
      { method: 'POST', body: JSON.stringify(payload) },
      options,
    )
  },

  status(orderId: string, options?: RequestOptions): Promise<PaymentStatusResult> {
    return apiFetch<PaymentStatusResult>(
      `/payments/status/${encodeURIComponent(orderId)}`,
      { method: 'GET' },
      options,
    )
  },

  /**
   * Opens the Razorpay checkout modal and resolves only after the customer
   * completes (or abandons) payment.
   */
  openCheckout(
    init: RazorpayInit,
    onDismiss: () => void,
  ): Promise<{ razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }> {
    if (!init.razorpayOrderId || !init.keyId) {
      return Promise.reject(new Error('Payment gateway is not ready. Please try again.'))
    }

    return new Promise((resolve, reject) => {
      loadRazorpayCheckout()
        .then(() => {
          const instance = new window.Razorpay!({
            key: init.keyId,
            amount: init.amountInPaise,
            currency: init.currency || 'INR',
            name: 'Vedhic Foods',
            description: init.description || `Payment for order ${init.orderNumber}`,
            order_id: init.razorpayOrderId,
            prefill: {
              name: init.customerName || '',
              email: init.customerEmail || '',
              contact: init.customerPhone || '',
            },
            theme: { color: '#3b7a57' },
            handler: (response) => {
              resolve({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              })
            },
            modal: {
              ondismiss: () => {
                onDismiss()
                reject(new Error('Payment window was closed before completion.'))
              },
            },
          })
          instance.open()
        })
        .catch(reject)
    })
  },
}