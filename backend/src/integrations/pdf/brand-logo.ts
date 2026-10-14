import zlib from 'zlib'

/**
 * Dependency-free brand logo rasteriser.
 *
 * The invoice is a server-generated document and there is no committed brand
 * logo asset in the repository, so the mark is drawn directly into a real PNG
 * at runtime (instead of shipping a binary blob that is easy to lose or drift
 * from the brand palette). Encoding a tiny PNG by hand keeps the invoice
 * pipeline free of native image dependencies (sharp/canvas), which are painful
 * to install on the deployment target.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/**
 * Renders the Vedhic Foods mark: a gold ring around a cream disc, with a
 * green leaf and gold vein at the centre. Returned as an RGBA PNG buffer that
 * PDFKit can embed directly.
 */
export function generateBrandLogoPng(size = 128): Buffer {
  const w = size
  const h = size
  const raw = Buffer.alloc(h * (1 + w * 4))

  const cx = w / 2
  const cy = h / 2
  const outer = size * 0.44
  const ringInner = size * 0.395
  const leafA = size * 0.3
  const leafB = size * 0.18
  const vein = size * 0.02
  const cos = Math.cos(Math.PI / 4)
  const sin = Math.sin(Math.PI / 4)

  for (let y = 0; y < h; y += 1) {
    const rowStart = y * (1 + w * 4)
    raw[rowStart] = 0 // PNG filter type: none

    for (let x = 0; x < w; x += 1) {
      const o = rowStart + 1 + x * 4
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      let r = 0
      let g = 0
      let b = 0
      let a = 0

      if (dist <= outer) {
        r = 0xfc
        g = 0xfa
        b = 0xf7
        a = 255
      }
      if (dist <= outer && dist >= ringInner) {
        r = 0x9e
        g = 0x74
        b = 0x28
      }

      const u = dx * cos + dy * sin
      const v = -dx * sin + dy * cos
      const leaf = (u * u) / (leafA * leafA) + (v * v) / (leafB * leafB)
      if (leaf <= 1) {
        r = 0x2f
        g = 0x5d
        b = 0x3a
        a = 255
        if (Math.abs(v) <= vein) {
          r = 0x9e
          g = 0x74
          b = 0x28
        }
      }

      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

let cachedLogo: Buffer | null = null

/** Returns the shared, memoised brand logo PNG buffer. */
export function getBrandLogoPng(): Buffer {
  if (!cachedLogo) cachedLogo = generateBrandLogoPng(128)
  return cachedLogo
}

export const BRAND_LOGO_MIME = 'image/png'
