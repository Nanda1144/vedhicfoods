import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const origin = 'https://vedhicfoods.com'
const apiBase = process.env.VITE_API_URL?.trim().replace(/\/$/, '')
const includeProducts = process.env.GENERATE_PRODUCT_SITEMAP === 'true'
if (includeProducts && !apiBase) {
  throw new Error('Set VITE_API_URL when GENERATE_PRODUCT_SITEMAP=true.')
}

const publicPaths = [
  '/', '/about', '/shop', '/categories', '/contact', '/faq', '/privacy', '/terms', '/refund-policy',
]
const urls = new Set(publicPaths.map((pathname) => `${origin}${pathname}`))

if (includeProducts) {
  for (let page = 1; page <= 500; page += 1) {
    const response = await fetch(`${apiBase}/products?page=${page}&per_page=100`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Product sitemap request failed with HTTP ${response.status}.`)

    const body = await response.json()
    const payload = body?.data ?? body
    const items = Array.isArray(payload?.items) ? payload.items : null
    if (!items) throw new Error('Product sitemap response did not contain an items array.')

    for (const product of items) {
      if (typeof product?.slug === 'string' && product.slug.trim()) {
        urls.add(`${origin}/product/${encodeURIComponent(product.slug.trim())}`)
      }
    }

    const totalPages = Number(payload.total_pages ?? payload.totalPages ?? 0)
    if (totalPages ? page >= totalPages : items.length < 100) break
    if (page === 500) throw new Error('Product sitemap exceeded the 500-page safety limit.')
  }
}

if (urls.size > 50_000) throw new Error('Sitemap has more than 50,000 URLs; split it into sitemap indexes.')
const xmlEscape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...[...urls].sort().map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`),
  '</urlset>',
  '',
].join('\n')

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.resolve(scriptDir, '../public/sitemap.xml')
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, xml, 'utf8')
process.stdout.write(`Wrote ${urls.size} public URLs${includeProducts ? ' including products' : ''} to frontend/public/sitemap.xml\n`)
