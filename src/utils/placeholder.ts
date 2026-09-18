/**
 * Original, copyright-free placeholder imagery generated as inline SVG.
 * Product photos are not provided for the prototype, so we synthesise
 * premium-feeling abstract compositions that stay on-brand per category.
 *
 * Replace `src` values from the data layer with real CDN images later —
 * the <SmartImage> component handles both identically.
 */

export type PlaceholderVariant = 'laddu' | 'roti' | 'grain' | 'jar' | 'generic'

interface PlaceholderOptions {
  seed: string
  variant?: PlaceholderVariant
  width?: number
  height?: number
  label?: string
}

interface Palette {
  from: string
  to: string
  glow: string
  ink: string
  accent: string
}

const PALETTES: Palette[] = [
  { from: '#FBF6EA', to: '#E9DDC2', glow: '#E9C876', ink: '#1F3D2B', accent: '#C9A24B' },
  { from: '#F4F1E3', to: '#DDE4CE', glow: '#A9B87C', ink: '#2A5138', accent: '#6B7B3A' },
  { from: '#F8EFE2', to: '#E5D2B4', glow: '#D8B969', ink: '#5C3F28', accent: '#B28F3C' },
  { from: '#F1EEE2', to: '#D8DCC6', glow: '#C4CE95', ink: '#33472F', accent: '#8A9A4E' },
  { from: '#FAF2E6', to: '#E7D9C1', glow: '#E0BE72', ink: '#4A3220', accent: '#9C7A2E' },
  { from: '#EFF2E6', to: '#D5DDC0', glow: '#B7C77F', ink: '#25402D', accent: '#7C8C4A' },
]

function hash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function ladduMotif(p: Palette, _w: number, _h: number, cx: number, cy: number, r: number) {
  const balls = [
    [0, 0, 1],
    [-1.25, 0.35, 0.82],
    [1.25, 0.35, 0.82],
    [-0.65, 1.15, 0.72],
    [0.65, 1.15, 0.72],
    [0, 1.9, 0.62],
  ]
  const nodes = balls
    .map(([dx, dy, s]) => {
      const x = round(cx + dx! * r * 0.62)
      const y = round(cy + dy! * r * 0.62)
      const rad = round(r * 0.42 * s!)
      return `
        <circle cx="${x}" cy="${y}" r="${rad}" fill="url(#sphere)" />
        <circle cx="${round(x - rad * 0.3)}" cy="${round(y - rad * 0.32)}" r="${round(rad * 0.3)}" fill="#ffffff" opacity="0.35" />`
    })
    .join('')
  return `
    <ellipse cx="${cx}" cy="${round(cy + r * 1.55)}" rx="${round(r * 1.5)}" ry="${round(r * 0.26)}" fill="${p.ink}" opacity="0.07" />
    ${nodes}`
}

function rotiMotif(p: Palette, cx: number, cy: number, r: number) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${round(r * 1.32)}" fill="url(#sphere)" opacity="0.9" />
    <circle cx="${cx}" cy="${cy}" r="${round(r * 1.1)}" fill="${p.glow}" opacity="0.28" />
    <circle cx="${cx}" cy="${cy}" r="${round(r * 0.82)}" fill="none" stroke="${p.ink}" stroke-opacity="0.13" stroke-width="${round(r * 0.05)}" />
    <circle cx="${cx}" cy="${cy}" r="${round(r * 0.52)}" fill="none" stroke="${p.ink}" stroke-opacity="0.1" stroke-width="${round(r * 0.04)}" />
    ${Array.from({ length: 14 })
      .map((_, i) => {
        const a = (i / 14) * Math.PI * 2
        const rr = r * (0.35 + ((i * 37) % 50) / 100)
        return `<circle cx="${round(cx + Math.cos(a) * rr)}" cy="${round(cy + Math.sin(a) * rr)}" r="${round(r * 0.035)}" fill="${p.ink}" opacity="0.16" />`
      })
      .join('')}`
}

function grainMotif(p: Palette, cx: number, cy: number, r: number) {
  const stalks = [-0.7, 0, 0.7]
  return stalks
    .map((offset) => {
      const x = round(cx + offset * r * 0.62)
      const top = round(cy - r * 1.15)
      const grains = Array.from({ length: 6 })
        .map((_, i) => {
          const gy = round(top + i * r * 0.3)
          const side = i % 2 === 0 ? 1 : -1
          return `<ellipse cx="${round(x + side * r * 0.15)}" cy="${gy}" rx="${round(r * 0.11)}" ry="${round(r * 0.2)}" fill="url(#sphere)" transform="rotate(${side * 22} ${round(x + side * r * 0.15)} ${gy})" />`
        })
        .join('')
      return `<path d="M ${x} ${round(cy + r * 0.7)} C ${x} ${round(cy - r * 0.2)} ${x} ${round(cy - r * 0.5)} ${x} ${top}" stroke="${p.accent}" stroke-width="${round(r * 0.045)}" fill="none" stroke-linecap="round" />${grains}`
    })
    .join('')
}

function jarMotif(p: Palette, cx: number, cy: number, r: number) {
  return `
    <rect x="${round(cx - r * 0.78)}" y="${round(cy - r * 0.6)}" width="${round(r * 1.56)}" height="${round(r * 1.85)}" rx="${round(r * 0.24)}" fill="url(#sphere)" />
    <rect x="${round(cx - r * 0.9)}" y="${round(cy - r * 0.85)}" width="${round(r * 1.8)}" height="${round(r * 0.34)}" rx="${round(r * 0.14)}" fill="${p.ink}" opacity="0.55" />
    <rect x="${round(cx - r * 0.6)}" y="${round(cy - r * 0.1)}" width="${round(r * 1.2)}" height="${round(r * 0.9)}" rx="${round(r * 0.12)}" fill="${p.glow}" opacity="0.4" />`
}

function motifFor(variant: PlaceholderVariant, p: Palette, w: number, h: number) {
  const cx = round(w / 2)
  const cy = round(h / 2)
  const r = round(Math.min(w, h) * 0.2)
  switch (variant) {
    case 'laddu':
      return ladduMotif(p, w, h, cx, cy, r)
    case 'roti':
      return rotiMotif(p, cx, cy, r)
    case 'grain':
      return grainMotif(p, cx, cy, r)
    case 'jar':
      return jarMotif(p, cx, cy, r)
    default:
      return `
        <circle cx="${cx}" cy="${cy}" r="${round(r * 1.2)}" fill="url(#sphere)" />
        <circle cx="${round(cx - r * 0.4)}" cy="${round(cy - r * 0.45)}" r="${round(r * 0.42)}" fill="#ffffff" opacity="0.3" />`
  }
}

export function placeholderImage({
  seed,
  variant = 'generic',
  width = 800,
  height = 800,
  label,
}: PlaceholderOptions): string {
  const h = hash(seed)
  const palette = PALETTES[h % PALETTES.length]!
  const rotate = (h % 40) - 20
  const glossId = `g${h % 9999}`
  const labelText = label
    ? `<text x="${round(width / 2)}" y="${round(height - height * 0.075)}" text-anchor="middle"
         font-family="Georgia, serif" font-size="${round(Math.min(width, height) * 0.045)}"
         fill="${palette.ink}" opacity="0.42" letter-spacing="1">${escapeXml(label.slice(0, 26))}</text>`
    : ''

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="${glossId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.from}" />
      <stop offset="100%" stop-color="${palette.to}" />
    </linearGradient>
    <radialGradient id="sphere" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
      <stop offset="45%" stop-color="${palette.glow}" />
      <stop offset="100%" stop-color="${palette.accent}" />
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.55" />
      <stop offset="100%" stop-color="${palette.glow}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#${glossId})" />
  <circle cx="${round(width * 0.5)}" cy="${round(height * 0.46)}" r="${round(Math.min(width, height) * 0.42)}" fill="url(#halo)" />
  <g transform="rotate(${rotate} ${round(width / 2)} ${round(height / 2)})">
    ${motifFor(variant, palette, width, height)}
  </g>
  ${labelText}
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Aspect-ratio helper used by image containers. */
export const ASPECT_RATIOS = {
  square: '1 / 1',
  portrait: '4 / 5',
  landscape: '4 / 3',
  wide: '16 / 9',
  banner: '21 / 9',
} as const

export type AspectRatio = keyof typeof ASPECT_RATIOS
