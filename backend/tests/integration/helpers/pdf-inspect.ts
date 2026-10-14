/**
 * Dependency-free PDF inspection helpers for invoice tests.
 *
 * PDFKit compresses page content streams with Flate, so the on-disk bytes are
 * opaque. Rather than pull in a heavyweight PDF parser (or a native dependency)
 * just to assert the invoice contents, this module:
 *
 *   1. Locates every `stream ... endstream` block.
 *   2. Inflates the ones that decompress and keeps those that carry text
 *      operators (`BT`/`Tj`), which correspond 1:1 to rendered pages.
 *   3. Parses text-showing operators (`Tj`/`TJ`) together with the active text
 *      matrix (`Tm`/`Td`/`TD`) and font size to recover the actual drawn text
 *      and its coordinates.
 *
 * That is enough to assert the fields rendered, the A4 media box, page breaks,
 * that no text falls outside the page (clipping) and that image XObjects (the
 * logo) are embedded.
 */

import zlib from 'zlib'

export interface PdfTextRun {
  text: string
  x: number
  y: number
  fontSize: number
}

export interface PdfPageInfo {
  index: number
  runs: PdfTextRun[]
  text: string
}

export interface PdfInspection {
  pages: PdfPageInfo[]
  pageCount: number
  mediaBoxes: Array<[number, number, number, number]>
  imageXObjects: number
  allText: string
}

/** Standard A4 in PDF points, as emitted by PDFKit. */
export const A4_WIDTH = 595.28
export const A4_HEIGHT = 841.89

function unescapePdfString(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, group: string) => {
    switch (group) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case '(':
        return '('
      case ')':
        return ')'
      case '\\':
        return '\\'
      default:
        return String.fromCharCode(parseInt(group, 8))
    }
  })
}

/** Decodes a `Tj`/`TJ` operand, which may mix literal `(...)` and hex `<...>` strings. */
function decodeOperand(operand: string): string {
  const tokens = operand.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>/g) || []
  return tokens
    .map((token) => {
      if (token.startsWith('<')) {
        const hex = token.slice(1, -1).replace(/\s+/g, '')
        const bytes: number[] = []
        for (let i = 0; i + 1 < hex.length; i += 2) {
          bytes.push(parseInt(hex.slice(i, i + 2), 16))
        }
        return Buffer.from(bytes).toString('latin1')
      }
      return unescapePdfString(token.slice(1, -1))
    })
    .join('')
}

/** Extracts all text operands from a single (already decoded) content stream. */
function parseRuns(content: string): PdfTextRun[] {
  const runs: PdfTextRun[] = []
  const lines = content.split(/\r?\n/)

  let x = 0
  let y = 0
  let fontSize = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const tf = /^\/([A-Za-z0-9]+)\s+([\d.]+)\s+Tf$/.exec(trimmed)
    if (tf) {
      fontSize = parseFloat(tf[2]!)
      continue
    }

    const tm = /^([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm$/.exec(trimmed)
    if (tm) {
      x = parseFloat(tm[5]!)
      y = parseFloat(tm[6]!)
      continue
    }

    const td = /^([\d.-]+)\s+([\d.-]+)\s+(Td|TD)$/.exec(trimmed)
    if (td) {
      x += parseFloat(td[1]!)
      y += parseFloat(td[2]!)
      continue
    }

    const single = /^(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*Tj$/.exec(trimmed)
    const array = /^(\[[^\]]*\])\s*TJ$/.exec(trimmed)
    const operand = single?.[1] ?? array?.[1]
    if (operand) {
      runs.push({ text: decodeOperand(operand), x, y, fontSize })
    }
  }

  return runs
}

/** Decodes every Flate-encoded stream in the file, skipping undecodable ones. */
function decodeStreams(pdf: Buffer): string[] {
  const decoded: string[] = []
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match: RegExpExecArray | null

  while ((match = streamRe.exec(pdf.toString('latin1'))) !== null) {
    const raw = Buffer.from(match[1]!, 'latin1')
    try {
      decoded.push(zlib.inflateSync(raw).toString('latin1'))
    } catch {
      // Not a Flate stream (e.g. an embedded image); ignore it for text parsing.
    }
  }

  return decoded
}

export function inspectPdf(pdf: Buffer): PdfInspection {
  const latin = pdf.toString('latin1')
  const streams = decodeStreams(pdf)

  const contentStreams = streams.filter((s) => /(^|\n)BT(\n|$)/.test(s) && /\bTj\b|\bTJ\b/.test(s))

  const pages: PdfPageInfo[] = contentStreams.map((content, index) => {
    const runs = parseRuns(content)
    return { index, runs, text: runs.map((r) => r.text).join('\n') }
  })

  const mediaBoxes: Array<[number, number, number, number]> = []
  for (const m of latin.matchAll(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/g)) {
    mediaBoxes.push([parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!), parseFloat(m[4]!)])
  }

  const imageXObjects = (latin.match(/\/Subtype\s*\/Image/g) || []).length

  return {
    pages,
    pageCount: pages.length,
    mediaBoxes,
    imageXObjects,
    allText: pages.map((p) => p.text).join('\n---PAGE---\n'),
  }
}

/** All text on a page, ignoring the injected footer band. */
export function bodyText(page: PdfPageInfo): string {
  return page.runs
    .filter((r) => !/Page \d+ of \d+|Thank you for choosing|computer-generated invoice|For questions contact/.test(r.text))
    .map((r) => r.text)
    .join('\n')
}

/** Text runs whose baseline sits within a horizontal band (PDF coords, origin bottom-left). */
export function runsInBand(page: PdfPageInfo, minY: number, maxY: number): PdfTextRun[] {
  return page.runs.filter((r) => r.y >= minY && r.y <= maxY)
}
