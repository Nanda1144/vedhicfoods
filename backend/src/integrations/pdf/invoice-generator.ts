import PDFDocument from 'pdfkit'
import { getBrandLogoPng } from './brand-logo'

export interface InvoiceItem {
  name: string
  sku?: string
  unit?: string
  price: number
  quantity: number
  subtotal: number
}

export interface InvoiceData {
  invoiceNumber: string
  orderNumber: string
  orderDate: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  shippingAddress: {
    fullName: string
    line1: string
    line2?: string
    city: string
    state: string
    pincode: string
    country: string
  }
  items: InvoiceItem[]
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
  paymentMethod: string
  paymentStatus: string
}

/** A4 geometry (PDF points). */
const MARGIN = 40
const RIGHT_EDGE = 555
const FOOTER_LINE_Y = 740
/** Items/summary must end above this so nothing collides with the footer band. */
const CONTENT_BOTTOM = 716
const ROW_HEIGHT = 20

const COLORS = {
  primary: '#2C2214',
  accent: '#9E7428',
  muted: '#766B57',
  border: '#E8E1D5',
  headerBg: '#F8F5F0',
  rowAlt: '#FCFAF7',
  totalBg: '#F2EADB',
} as const

export class InvoiceGenerator {
  /**
   * Generates a standard A4 print-ready PDF invoice Buffer.
   *
   * The layout is paginated: line items flow onto continuation pages when they
   * would otherwise run into the footer band, and the financial summary is
   * moved to a fresh page if it would overlap. The footer (with page numbers)
   * is stamped onto every buffered page at the end, so it is always present and
   * never overwritten.
   */
  public static async generateA4Pdf(data: InvoiceData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: MARGIN,
          bufferPages: true,
          info: {
            Title: `Invoice-${data.invoiceNumber}`,
            Author: 'Vedhic Foods',
            Subject: `Tax Invoice for Order ${data.orderNumber}`,
          },
        })

        const buffers: Buffer[] = []
        doc.on('data', buffers.push.bind(buffers))
        doc.on('end', () => resolve(Buffer.concat(buffers)))
        doc.on('error', (err) => reject(err))

        const { primary, accent, muted, border, headerBg, rowAlt, totalBg } = COLORS
        const logo = getBrandLogoPng()

        // PDFKit's built-in fonts are WinAnsi-encoded and have no glyph for the
        // rupee sign (U+20B9): emitting it prints a corrupted byte (observed as
        // `0xB9`). A text search can't verify a glyph that isn't there, so the
        // invoice uses the unambiguous ASCII "Rs." prefix instead. Registering a
        // Unicode TTF would be the alternative, but the repo ships no font asset.
        const money = (amount: number): string => `Rs. ${amount.toFixed(2)}`

        const drawTableHeader = (atY: number): number => {
          doc.rect(MARGIN, atY - 5, 515, 22).fill(headerBg)
          doc
            .fillColor(primary)
            .font('Helvetica-Bold')
            .fontSize(9)
            .text('ITEM DESCRIPTION', 48, atY)
            .text('UNIT', 290, atY)
            .text('PRICE', 355, atY, { align: 'right', width: 58 })
            .text('QTY', 425, atY, { align: 'center', width: 30 })
            .text('TOTAL', 485, atY, { align: 'right', width: 60 })
          return atY + 24
        }

        const drawContinuationHeader = (): void => {
          doc.image(logo, MARGIN, 34, { width: 34, height: 34 })
          doc
            .fillColor(accent)
            .fontSize(14)
            .font('Helvetica-Bold')
            .text('VEDHIC FOODS', 84, 38)
          doc
            .fillColor(primary)
            .fontSize(12)
            .font('Helvetica-Bold')
            .text('TAX INVOICE (contd.)', 380, 40, { align: 'right', width: 175 })
          doc
            .fillColor(muted)
            .fontSize(8)
            .font('Helvetica')
            .text(`Invoice No: ${data.invoiceNumber}  |  Order No: ${data.orderNumber}`, 84, 58)
          doc.strokeColor(border).lineWidth(1).moveTo(MARGIN, 78).lineTo(RIGHT_EDGE, 78).stroke()
        }

        const drawRow = (item: InvoiceItem, atY: number, index: number): void => {
          const rowBg = index % 2 === 0 ? '#FFFFFF' : rowAlt
          doc.rect(MARGIN, atY - 4, 515, ROW_HEIGHT).fill(rowBg)
          doc
            .fillColor(primary)
            .font('Helvetica')
            .fontSize(9)
            .text(item.name, 48, atY, { width: 235, ellipsis: true })
            .text(item.unit || 'piece', 290, atY)
            .text(money(item.price), 355, atY, { align: 'right', width: 58 })
            .text(String(item.quantity), 425, atY, { align: 'center', width: 30 })
            .text(money(item.subtotal), 485, atY, { align: 'right', width: 60 })
        }

        // -----------------------------------------------------------------
        // Page 1 header
        // -----------------------------------------------------------------
        doc.image(logo, MARGIN, 34, { width: 46, height: 46 })
        doc
          .fillColor(accent)
          .fontSize(22)
          .font('Helvetica-Bold')
          .text('VEDHIC FOODS', 96, 40)

        doc
          .fillColor(muted)
          .fontSize(9)
          .font('Helvetica')
          .text('Pure Farm-Fresh Millets & Heritage Organic Laddus', 96, 68, { width: 270 })
          .text('FSSAI Lic. No: 11224333000123 | GSTIN: 29AABCU9603R1ZM', 96, 80, { width: 270 })
          .text('Bengaluru, Karnataka - 560038 | care@vedhicfoods.com', 96, 92, { width: 270 })

        doc
          .fillColor(primary)
          .fontSize(18)
          .font('Helvetica-Bold')
          .text('TAX INVOICE', 380, 40, { align: 'right', width: 175 })

        doc
          .fillColor(muted)
          .fontSize(9)
          .font('Helvetica')
          .text(`Invoice No: ${data.invoiceNumber}`, 380, 66, { align: 'right', width: 175 })
          .text(`Order No: ${data.orderNumber}`, 380, 78, { align: 'right', width: 175 })
          .text(`Date: ${data.orderDate}`, 380, 90, { align: 'right', width: 175 })
          .text(
            `Payment: ${data.paymentMethod.toUpperCase()} (${data.paymentStatus.toUpperCase()})`,
            380,
            102,
            { align: 'right', width: 175 }
          )

        doc.strokeColor(border).lineWidth(1).moveTo(MARGIN, 120).lineTo(RIGHT_EDGE, 120).stroke()

        // Billed & shipped to
        doc
          .fillColor(primary)
          .fontSize(10)
          .font('Helvetica-Bold')
          .text('BILLED & SHIPPED TO:', MARGIN, 135)

        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(primary)
          .text(data.shippingAddress.fullName || data.customerName, MARGIN, 150)
          .text(data.shippingAddress.line1, MARGIN, 162)
          .text(data.shippingAddress.line2 ? `${data.shippingAddress.line2}, ` : '', MARGIN, 174)
          .text(
            `${data.shippingAddress.city}, ${data.shippingAddress.state} - ${data.shippingAddress.pincode}`,
            MARGIN,
            186
          )
          .text(`Phone: ${data.customerPhone || 'N/A'} | Email: ${data.customerEmail}`, MARGIN, 198)

        doc.strokeColor(border).lineWidth(1).moveTo(MARGIN, 220).lineTo(RIGHT_EDGE, 220).stroke()

        // -----------------------------------------------------------------
        // Line items (paginated)
        // -----------------------------------------------------------------
        let y = drawTableHeader(235)

        data.items.forEach((item, index) => {
          if (y + ROW_HEIGHT > CONTENT_BOTTOM) {
            doc.addPage()
            drawContinuationHeader()
            y = drawTableHeader(92)
          }
          drawRow(item, y, index)
          y += ROW_HEIGHT
        })

        const hasDiscount = data.discount > 0
        const summaryHeight = 16 + (hasDiscount ? 16 : 0) + 16 + 20 + 26 + 12

        if (y + summaryHeight > CONTENT_BOTTOM) {
          doc.addPage()
          drawContinuationHeader()
          y = 92
        }

        doc.strokeColor(border).lineWidth(1).moveTo(MARGIN, y).lineTo(RIGHT_EDGE, y).stroke()
        y += 12

        // -----------------------------------------------------------------
        // Financial summary
        // -----------------------------------------------------------------
        const summaryX = 350
        const valueX = 475

        doc.font('Helvetica').fontSize(9).fillColor(muted)
        doc
          .text('Subtotal:', summaryX, y)
          .text(money(data.subtotal), valueX, y, { align: 'right', width: 70 })
        y += 16

        if (hasDiscount) {
          doc
            .text('Discount:', summaryX, y)
            .text(`-${money(data.discount)}`, valueX, y, { align: 'right', width: 70 })
          y += 16
        }

        doc
          .text('Delivery Charges:', summaryX, y)
          .text(data.shipping > 0 ? money(data.shipping) : 'FREE', valueX, y, {
            align: 'right',
            width: 70,
          })
        y += 16

        doc
          .text('GST (5% Included):', summaryX, y)
          .text(money(data.tax), valueX, y, { align: 'right', width: 70 })
        y += 20

        doc.rect(summaryX - 10, y - 6, 205, 26).fill(totalBg)
        doc
          .fillColor(primary)
          .font('Helvetica-Bold')
          .fontSize(11)
          .text('GRAND TOTAL:', summaryX, y)
          .text(money(data.total), valueX - 10, y, { align: 'right', width: 80 })

        // -----------------------------------------------------------------
        // Footer on every page + page numbers
        // -----------------------------------------------------------------
        const range = doc.bufferedPageRange()
        const totalPages = range.count

        for (let i = range.start; i < range.start + range.count; i += 1) {
          doc.switchToPage(i)
          doc.strokeColor(border).lineWidth(1).moveTo(MARGIN, FOOTER_LINE_Y).lineTo(RIGHT_EDGE, FOOTER_LINE_Y).stroke()
          doc
            .fillColor(muted)
            .fontSize(8)
            .font('Helvetica')
            .text(
              'Thank you for choosing pure, chemical-free traditional foods for your family!',
              MARGIN,
              FOOTER_LINE_Y + 10,
              { align: 'center', width: 515 }
            )
            .text(
              'This is a computer-generated invoice and requires no physical signature.',
              MARGIN,
              FOOTER_LINE_Y + 22,
              { align: 'center', width: 515 }
            )
            .text(
              `For questions contact care@vedhicfoods.com | Page ${i - range.start + 1} of ${totalPages}`,
              MARGIN,
              FOOTER_LINE_Y + 34,
              { align: 'center', width: 515 }
            )
        }

        doc.end()
      } catch (err) {
        reject(err)
      }
    })
  }
}
