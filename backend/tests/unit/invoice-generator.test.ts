import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { InvoiceGenerator, InvoiceData, InvoiceItem } from '../../src/integrations/pdf/invoice-generator'
import { inspectPdf, A4_WIDTH, A4_HEIGHT, type PdfTextRun } from '../integration/helpers/pdf-inspect'

const sampleData = (overrides: Partial<InvoiceData> = {}): InvoiceData => ({
  invoiceNumber: 'INV-2026-000123',
  orderNumber: 'VF-2026-000456',
  orderDate: '2026-10-09',
  customerName: 'Ananya Iyer',
  customerEmail: 'ananya.iyer@example.com',
  customerPhone: '9876501234',
  shippingAddress: {
    fullName: 'Ananya Iyer',
    line1: 'No. 42, Mango Grove Layout',
    line2: 'Indiranagar 2nd Stage',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
    country: 'India',
  },
  items: [
    { name: 'Organic Little Millet', sku: 'SKU-MILLET-01', unit: '500g', price: 250, quantity: 4, subtotal: 1000 },
  ],
  subtotal: 1000,
  discount: 100,
  shipping: 49,
  tax: 45,
  total: 994,
  paymentMethod: 'RAZORPAY',
  paymentStatus: 'PAID',
  ...overrides,
})

function makeItems(count: number): InvoiceItem[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Millet Variety ${String(i + 1).padStart(2, '0')}`,
    sku: `SKU-MILLET-${String(i + 1).padStart(2, '0')}`,
    unit: '500g',
    price: 100 + i,
    quantity: (i % 3) + 1,
    subtotal: (100 + i) * ((i % 3) + 1),
  }))
}

/** Approximate rendered width of a text run (Helvetica is ~0.5em average). */
function runBox(run: PdfTextRun): { x1: number; y1: number; x2: number; y2: number } {
  const width = run.fontSize * 0.5 * run.text.length + 1
  const height = run.fontSize
  return { x1: run.x, y1: run.y, x2: run.x + width, y2: run.y + height }
}

function significantOverlaps(runs: PdfTextRun[]): string[] {
  const cleaned = runs.filter((r) => r.text.trim().length > 1)
  const overlaps: string[] = []

  for (let i = 0; i < cleaned.length; i += 1) {
    for (let j = i + 1; j < cleaned.length; j += 1) {
      const a = runBox(cleaned[i]!)
      const b = runBox(cleaned[j]!)
      const overlapX = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)
      const overlapY = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)
      if (overlapX <= 2 || overlapY <= 2) continue

      const area = overlapX * overlapY
      const aArea = (a.x2 - a.x1) * (a.y2 - a.y1)
      const bArea = (b.x2 - b.x1) * (b.y2 - b.y1)
      if (area / Math.min(aArea, bArea) > 0.35) {
        overlaps.push(`"${cleaned[i]!.text}" over "${cleaned[j]!.text}"`)
      }
    }
  }

  return overlaps
}

describe('InvoiceGenerator A4 PDF', () => {
  it('renders a single-page A4 document with every required field', async () => {
    const pdf = await InvoiceGenerator.generateA4Pdf(sampleData())
    const insp = inspectPdf(pdf)

    // A4 media box
    expect(insp.mediaBoxes.length).toBeGreaterThanOrEqual(1)
    const [bx, by, bw, bh] = insp.mediaBoxes[0]!
    expect(bx).toBeCloseTo(0, 1)
    expect(by).toBeCloseTo(0, 1)
    expect(bw).toBeCloseTo(A4_WIDTH, 0)
    expect(bh).toBeCloseTo(A4_HEIGHT, 0)

    expect(insp.pageCount).toBe(1)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')

    // Business logo is a real embedded image (not just text)
    expect(insp.imageXObjects).toBeGreaterThanOrEqual(1)

    const text = insp.allText
    // Business + invoice identity
    expect(text).toContain('VEDHIC FOODS')
    expect(text).toContain('TAX INVOICE')
    expect(text).toContain('FSSAI')
    expect(text).toContain('GSTIN: 29AABCU9603R1ZM')
    expect(text).toContain('INV-2026-000123')
    expect(text).toContain('VF-2026-000456')
    expect(text).toContain('2026-10-09')

    // Customer + delivery address
    expect(text).toContain('Ananya Iyer')
    expect(text).toContain('ananya.iyer@example.com')
    expect(text).toContain('9876501234')
    expect(text).toContain('No. 42, Mango Grove Layout')
    expect(text).toContain('Bengaluru, Karnataka - 560038')

    // Payment
    expect(text).toContain('RAZORPAY')
    expect(text).toContain('PAID')

    // Line item: name, unit, price, qty, subtotal
    expect(text).toContain('Organic Little Millet')
    expect(text).toContain('500g')
    expect(text).toContain('Rs. 250.00')
    expect(text).toContain('Rs. 1000.00')

    // Financial summary + totals
    expect(text).toContain('Subtotal:')
    expect(text).toContain('Discount:')
    expect(text).toContain('-Rs. 100.00')
    expect(text).toContain('Delivery Charges:')
    expect(text).toContain('Rs. 49.00')
    expect(text).toContain('GST (5% Included):')
    expect(text).toContain('Rs. 45.00')
    expect(text).toContain('GRAND TOTAL:')
    expect(text).toContain('Rs. 994.00')
  })

  it('shows the discount row only when a discount was applied', async () => {
    const withDiscount = inspectPdf(await InvoiceGenerator.generateA4Pdf(sampleData({ discount: 100 })))
    expect(withDiscount.allText).toContain('Discount:')

    const withoutDiscount = inspectPdf(
      await InvoiceGenerator.generateA4Pdf(sampleData({ discount: 0, total: 1094 }))
    )
    expect(withoutDiscount.allText).not.toContain('Discount:')
    expect(withoutDiscount.allText).toContain('Delivery Charges:')
  })

  it('prints FREE delivery when shipping is waived', async () => {
    const insp = inspectPdf(await InvoiceGenerator.generateA4Pdf(sampleData({ shipping: 0 })))
    expect(insp.allText).toContain('FREE')
  })

  it('paginates large invoices without losing items or clipping content', async () => {
    const items = makeItems(60)
    const pdf = await InvoiceGenerator.generateA4Pdf(sampleData({ items }))
    const insp = inspectPdf(pdf)

    expect(insp.pageCount).toBeGreaterThan(1)

    // Every item appears exactly once across the whole document.
    for (const item of items) {
      const found = insp.pages.flatMap((p) => p.runs).filter((r) => r.text === item.name)
      expect(found.length, `item ${item.name} rendered ${found.length} times`).toBe(1)
    }

    // Grand total / summary appears exactly once.
    const grandTotals = insp.pages.flatMap((p) => p.runs).filter((r) => r.text === 'GRAND TOTAL:')
    expect(grandTotals.length).toBe(1)

    // Footer + page numbering on every page.
    insp.pages.forEach((page, index) => {
      expect(page.text).toContain(`Page ${index + 1} of ${insp.pageCount}`)
      expect(page.text).toContain('computer-generated invoice')
    })

    // Nothing is drawn outside the page area (clipping guard).
    for (const page of insp.pages) {
      for (const run of page.runs) {
        expect(run.y).toBeGreaterThan(0)
        expect(run.y).toBeLessThan(A4_HEIGHT)
        expect(run.x).toBeGreaterThanOrEqual(0)
        expect(run.x).toBeLessThan(A4_WIDTH)
      }
    }
  })

  it('lays text out without significant overlaps', async () => {
    const insp = inspectPdf(await InvoiceGenerator.generateA4Pdf(sampleData({ items: makeItems(8) })))
    for (const page of insp.pages) {
      expect(significantOverlaps(page.runs)).toEqual([])
    }
  })

  it('writes real, openable sample invoices to disk for manual inspection', async () => {
    const outDir = path.resolve(process.cwd(), 'tests', 'output', 'invoices')
    fs.mkdirSync(outDir, { recursive: true })

    const cases: Array<[string, InvoiceData]> = [
      ['sample-single.pdf', sampleData()],
      ['sample-no-discount-free-shipping.pdf', sampleData({ discount: 0, shipping: 0, total: 1095 })],
      ['sample-many-items.pdf', sampleData({ items: makeItems(60) })],
    ]

    for (const [filename, data] of cases) {
      const pdf = await InvoiceGenerator.generateA4Pdf(data)
      const filePath = path.join(outDir, filename)
      fs.writeFileSync(filePath, pdf)

      expect(fs.existsSync(filePath)).toBe(true)
      expect(pdf.length).toBeGreaterThan(1000)
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(pdf.toString('latin1')).toContain('%%EOF')

      const insp = inspectPdf(pdf)
      expect(insp.pageCount).toBeGreaterThanOrEqual(1)
      expect(insp.allText).toContain('GRAND TOTAL:')
    }
  })
})
