// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOrdersPage } from '@/pages/admin/AdminOrdersPage'
import { ToastProvider, ToastViewport } from '@/context'
import type { Order } from '@/types'

/**
 * Drives the real `AdminOrdersPage` list through its rendered DOM.
 *
 * The search/status/payment predicates are now pure (`@/utils/orderList`) and
 * unit-tested separately, so this file focuses on the wiring the unit test cannot
 * see: that typing in the toolbar narrows the rendered rows, that a status chip
 * does too, that the pagination bar windows the filtered set, and that the
 * "Export CSV" control is present and serialises exactly the filtered rows.
 */

const mocks = vi.hoisted(() => ({
  orders: vi.fn(),
  downloadCsv: vi.fn(),
}))

vi.mock('@/services/adminService', () => ({
  adminService: {
    orders: mocks.orders,
    order: vi.fn(),
    updateOrderStatus: vi.fn(),
  },
}))

vi.mock('@/services/invoiceService', () => ({
  invoiceService: { downloadUrl: vi.fn() },
}))

vi.mock('@/context/AdminAuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AdminAuthContext')>()
  return {
    ...actual,
    useAdminAuth: () => ({
      session: null,
      loading: false,
      sessionExpired: false,
      can: () => true,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
      setSession: vi.fn(),
    }),
  }
})

vi.mock('@/utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/csv')>()
  return { ...actual, downloadCsv: mocks.downloadCsv }
})

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    orderNumber: 'VF-1001',
    customerId: 'usr_1',
    customerName: 'Asha Rao',
    customerEmail: 'asha@example.com',
    items: [],
    subtotal: 1000,
    savings: 0,
    shipping: 50,
    tax: 180.5,
    discount: 0,
    total: 1230.5,
    status: 'confirmed',
    paymentStatus: 'paid',
    timeline: [],
    placedAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  }
}

const ORDERS: Order[] = [
  order({ id: 'a', orderNumber: 'VF-1001', customerName: 'Asha Rao', customerEmail: 'asha@example.com', status: 'pending', paymentStatus: 'pending' }),
  order({ id: 'b', orderNumber: 'VF-1002', customerName: 'Bharat Menon', customerEmail: 'bharat@example.com', status: 'shipped', paymentStatus: 'paid' }),
  order({ id: 'c', orderNumber: 'VF-1003', customerName: 'Chitra Iyer', customerEmail: 'chitra@corp.example', status: 'delivered', paymentStatus: 'refunded' }),
]

let container: HTMLDivElement
let root: Root

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderPage(orders: Order[] = ORDERS): Promise<void> {
  mocks.orders.mockResolvedValue(orders)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(
      <MemoryRouter>
        <ToastProvider>
          <AdminOrdersPage />
          <ToastViewport />
        </ToastProvider>
      </MemoryRouter>,
    )
  })
  await flush()
  await flush()
}

function searchInput(): HTMLInputElement {
  return container.querySelector('input[type="search"]') as HTMLInputElement
}

function clickByText(text: string): void {
  const button = Array.from(container.querySelectorAll('button')).find((btn) => btn.textContent?.includes(text))
  expect(button, `button containing "${text}"`).toBeTruthy()
  act(() => button!.click())
}

function typeSearch(value: string): void {
  const input = searchInput()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function selectPayment(value: string): void {
  const select = container.querySelector('select[aria-label="Filter by payment"]') as HTMLSelectElement
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

beforeEach(() => {
  mocks.orders.mockReset()
  mocks.downloadCsv.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AdminOrdersPage list', () => {
  it('renders a row per order from the service', async () => {
    await renderPage()
    expect(container.textContent).toContain('VF-1001')
    expect(container.textContent).toContain('VF-1002')
    expect(container.textContent).toContain('VF-1003')
    expect(container.textContent).toContain('3 orders')
  })

  it('narrows the rows to a search term across number, name and email', async () => {
    await renderPage()

    typeSearch('bharat')
    expect(container.textContent).toContain('VF-1002')
    expect(container.textContent).not.toContain('VF-1001')
    expect(container.textContent).not.toContain('VF-1003')

    typeSearch('corp.example')
    expect(container.textContent).toContain('VF-1003')
    expect(container.textContent).not.toContain('VF-1002')

    typeSearch('VF-1001')
    expect(container.textContent).toContain('VF-1001')
    expect(container.textContent).not.toContain('VF-1003')
  })

  it('filters through the status chips', async () => {
    await renderPage()

    clickByText('shipped')
    expect(container.textContent).toContain('VF-1002')
    expect(container.textContent).not.toContain('VF-1001')

    clickByText('All')
    expect(container.textContent).toContain('VF-1001')
    expect(container.textContent).toContain('VF-1003')
  })

  it('filters through the payment dropdown', async () => {
    await renderPage()

    selectPayment('refunded')
    expect(container.textContent).toContain('VF-1003')
    expect(container.textContent).not.toContain('VF-1001')
  })
})

describe('AdminOrdersPage pagination', () => {
  const many: Order[] = Array.from({ length: 12 }, (_, index) =>
    order({ id: `m${index}`, orderNumber: `VF-2${String(index).padStart(3, '0')}`, customerName: `Customer ${index}` }),
  )

  it('windows the filtered set at 10 rows and pages on demand', async () => {
    await renderPage(many)

    expect(container.textContent).toContain('Showing 1–10 of 12')
    expect(container.textContent).toContain('VF-2000')
    expect(container.textContent).not.toContain('VF-2010')

    clickByText('2')
    expect(container.textContent).toContain('Showing 11–12 of 12')
    expect(container.textContent).toContain('VF-2010')
    expect(container.textContent).not.toContain('VF-2000')
  })

  it('resets to page 1 when the search term changes', async () => {
    await renderPage(many)

    clickByText('2')
    expect(container.textContent).toContain('Showing 11–12 of 12')

    typeSearch('Customer 0')
    expect(container.textContent).toContain('1 record')
    expect(container.textContent).toContain('VF-2000')
    expect(container.textContent).not.toContain('VF-2010')
  })
})

describe('AdminOrdersPage CSV export', () => {
  it('exposes an Export CSV control that serialises the filtered set', async () => {
    await renderPage()

    typeSearch('bharat')
    clickByText('Export CSV')

    expect(mocks.downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, csv] = mocks.downloadCsv.mock.calls[0]!
    expect(String(filename)).toMatch(/^order-gst-report-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(String(csv)).toContain('VF-1002')
    expect(String(csv)).not.toContain('VF-1001')
    expect(String(csv)).not.toContain('VF-1003')
  })

  it('does not download when no order matches the current filters', async () => {
    await renderPage()

    typeSearch('no-such-order')
    clickByText('Export CSV')

    expect(mocks.downloadCsv).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Nothing to export')
  })
})
