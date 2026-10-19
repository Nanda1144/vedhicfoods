import type { Order } from '@/types'

/**
 * RFC-4180 CSV generation for the admin console's compliance exports.
 *
 * Deliberately dependency-free: the file is a few dozen lines and pulling a CSV
 * library in for it would add an attack surface and a bundle to audit for no
 * gain. The escaping rules are the only part that has to be exactly right, so
 * they live in their own pure function that the test suite pins down.
 */

/** Excel needs this to decode the byte stream as UTF-8; without it the rupee sign renders as mojibake. */
export const CSV_BOM = '\uFEFF'

/** CRLF is what RFC-4180 specifies and what Excel expects on every platform. */
export const CSV_EOL = '\r\n'

/**
 * Escapes a single CSV field.
 *
 * A field is wrapped in double quotes only when it contains a comma, a double
 * quote, or a line break; any embedded double quote is then doubled. Fields that
 * contain none of those are emitted verbatim so ordinary values stay readable.
 */
export function escapeCsvField(value: unknown): string {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Serialises a matrix of values into an RFC-4180 CSV document. */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options: { bom?: boolean } = {},
): string {
  const { bom = true } = options
  if (rows.length === 0) return bom ? CSV_BOM : ''
  const body = rows.map((row) => row.map(escapeCsvField).join(',')).join(CSV_EOL)
  return `${bom ? CSV_BOM : ''}${body}${CSV_EOL}`
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** ₹1,234.56 — two decimals because GST reporting carries paise. */
function formatInr(value: number): string {
  return Number.isFinite(value) ? inrFormatter.format(value) : ''
}

/** ISO calendar date (`YYYY-MM-DD`); stable and locale-independent for a machine-readable export. */
function formatOrderDate(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/**
 * Value GST is levied on: everything the customer was charged except the tax
 * itself. The `Order` projection exposes `total` and `tax`, not a pre-computed
 * taxable base, so it is derived here rather than invented.
 */
function taxableValue(order: Order): number {
  const total = Number(order.total)
  const tax = Number(order.tax)
  if (!Number.isFinite(total) || !Number.isFinite(tax)) return 0
  return Math.max(0, total - tax)
}

export const GST_REPORT_HEADERS = [
  'Order Number',
  'Order Date',
  'Customer Name',
  'Customer Email',
  'Place of Supply',
  'Taxable Value (INR)',
  'GST Amount (INR)',
  'Total (INR)',
  'Payment Status',
] as const

/**
 * Builds the GST report body from the admin `Order` projection.
 *
 * Only fields that actually exist on the type are emitted. GSTIN is not on the
 * type at all (the invoice projection carries it, but the orders endpoint does
 * not), so no GSTIN column is fabricated. Place of supply is only present on the
 * detail projection, so it degrades to an empty cell on the list view. The
 * backend does not split tax into CGST/SGST/IGST here, so the total tax is
 * reported as the GST amount.
 */
export function buildGstReportRows(orders: ReadonlyArray<Order>): string[][] {
  return orders.map((order) => [
    order.orderNumber,
    formatOrderDate(order.placedAt),
    order.customerName,
    order.customerEmail,
    order.address?.state ?? '',
    formatInr(taxableValue(order)),
    formatInr(order.tax),
    formatInr(order.total),
    order.paymentStatus,
  ])
}

/** Complete GST report document (BOM + header + rows) for the given orders. */
export function buildGstReportCsv(orders: ReadonlyArray<Order>): string {
  return toCsv([[...GST_REPORT_HEADERS], ...buildGstReportRows(orders)])
}

/** `prefix-YYYY-MM-DD.csv`, built from local calendar parts so the stamp matches the operator's day. */
export function csvFilename(prefix: string, date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${prefix}-${year}-${month}-${day}.csv`
}

/** Triggers a client-side download for an already-serialised CSV document. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke on the next tick so the browser has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
