import { describe, expect, it } from 'vitest'
import {
  CSV_BOM,
  buildGstReportCsv,
  csvFilename,
  escapeCsvField,
  toCsv,
} from '@/utils/csv'
import type { Order } from '@/types'

/**
 * RFC-4180 escaping is the load-bearing part of a compliance export: a single
 * unescaped comma or quote in a customer name silently shifts every following
 * column, and the report is read by an accountant rather than a developer. These
 * tests pin the rules rather than the outward shape of any one screen.
 */

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

describe('escapeCsvField', () => {
  it('leaves fields without reserved characters untouched', () => {
    expect(escapeCsvField('plain')).toBe('plain')
    expect(escapeCsvField('VF-1001')).toBe('VF-1001')
    expect(escapeCsvField(0)).toBe('0')
  })

  it('quotes fields containing a comma', () => {
    expect(escapeCsvField('Asha, Rao')).toBe('"Asha, Rao"')
  })

  it('doubles embedded double quotes and quotes the field', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes fields containing line breaks', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('renders null and undefined as an empty field', () => {
    expect(escapeCsvField(null)).toBe('')
    expect(escapeCsvField(undefined)).toBe('')
  })
})

describe('toCsv', () => {
  it('prepends a UTF-8 BOM and terminates rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe(`${CSV_BOM}a,b\r\nc,d\r\n`)
  })

  it('omits the BOM when asked', () => {
    expect(toCsv([['a', 'b']], { bom: false })).toBe('a,b\r\n')
  })

  it('returns just the BOM (or nothing) for an empty matrix', () => {
    expect(toCsv([])).toBe(CSV_BOM)
    expect(toCsv([], { bom: false })).toBe('')
  })
})

describe('buildGstReportCsv', () => {
  it('emits the report header before any data row', () => {
    const csv = buildGstReportCsv([])
    const header = csv.slice(CSV_BOM.length).split('\r\n')[0]
    expect(header).toBe(
      'Order Number,Order Date,Customer Name,Customer Email,Place of Supply,' +
        'Taxable Value (INR),GST Amount (INR),Total (INR),Payment Status',
    )
  })

  it('exports the real Order fields with the rupee symbol, BOM and CRLF', () => {
    const csv = buildGstReportCsv([order()])

    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain('VF-1001')
    expect(csv).toContain('2026-01-15')
    expect(csv).toContain('asha@example.com')
    expect(csv).toContain('paid')
    // Taxable value is total − tax: 1230.50 − 180.50 = 1050.00.
    expect(csv).toContain('1,050.00')
    expect(csv).toContain('₹')
  })

  it('quotes a customer name that contains a comma', () => {
    const csv = buildGstReportCsv([order({ customerName: 'Asha, Rao' })])
    expect(csv).toContain('"Asha, Rao"')
  })

  it('leaves place of supply empty when the list projection omits the address', () => {
    const csv = buildGstReportCsv([order({ address: undefined })])
    const row = csv.slice(CSV_BOM.length).split('\r\n')[1]
    expect(row).not.toContain('undefined')
    // Blank cell sits between the email and the taxable value columns.
    expect(row).toContain(',,')
  })

  it('includes the state as place of supply when it is present', () => {
    const csv = buildGstReportCsv([
      order({
        address: {
          id: '',
          label: 'Delivery',
          fullName: 'Asha Rao',
          phone: '',
          line1: '',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '',
          country: 'India',
          isDefault: false,
        },
      }),
    ])
    expect(csv).toContain('Karnataka')
  })
})

describe('csvFilename', () => {
  it('stamps the local date onto the filename', () => {
    expect(csvFilename('order-gst-report', new Date(2026, 0, 15))).toBe('order-gst-report-2026-01-15.csv')
  })
})
