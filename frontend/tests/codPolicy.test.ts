import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { settingsService } from '@/services/settingsService'
import { PaymentMethodSelector } from '@/components/checkout/PaymentMethodSelector'

const fetchMock = vi.fn()

function respond(body: unknown): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settingsService COD mapping', () => {
  it('maps the public shipping_cod_enabled key to codEnabled (true)', async () => {
    respond({ success: true, data: { shipping_cod_enabled: 'true', brand_name: 'Vedhic Foods' } })

    const settings = await settingsService.get()

    expect(settings.codEnabled).toBe(true)
    expect(settings.brandName).toBe('Vedhic Foods')
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/settings')
  })

  it('maps a false value to codEnabled false', async () => {
    respond({ success: true, data: { shipping_cod_enabled: 'false' } })

    const settings = await settingsService.get()

    expect(settings.codEnabled).toBe(false)
  })

  it('accepts a boolean value', async () => {
    respond({ success: true, data: { shipping_cod_enabled: true } })

    const settings = await settingsService.get()

    expect(settings.codEnabled).toBe(true)
  })

  it('falls back to disabled when the backend omits the key', async () => {
    respond({ success: true, data: { brand_name: 'Vedhic Foods' } })

    const settings = await settingsService.get()

    expect(settings.codEnabled).toBe(false)
  })
})

describe('PaymentMethodSelector COD gating', () => {
  const render = (codEnabled: boolean) =>
    renderToStaticMarkup(
      createElement(PaymentMethodSelector, {
        value: 'razorpay',
        onChange: () => {},
        codEnabled,
      }),
    )

  it('renders both Razorpay and COD when enabled', () => {
    const html = render(true)

    expect(html).toContain('Razorpay')
    expect(html).toContain('Cash on Delivery')
  })

  it('renders Razorpay only when disabled', () => {
    const html = render(false)

    expect(html).toContain('Razorpay')
    expect(html).not.toContain('Cash on Delivery')
  })

  it('defaults to hiding COD when the flag is omitted', () => {
    const html = renderToStaticMarkup(
      createElement(PaymentMethodSelector, { value: 'razorpay', onChange: () => {} }),
    )

    expect(html).toContain('Razorpay')
    expect(html).not.toContain('Cash on Delivery')
  })
})
