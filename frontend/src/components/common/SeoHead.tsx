import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { SITE } from '@/config/site'

type SeoHeadProps = {
  title: string
  description: string
  noIndex?: boolean
  image?: string
  type?: 'website' | 'product'
  structuredData?: Record<string, unknown>
}

function ensureMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let element = Array.from(document.head.querySelectorAll<HTMLMetaElement>('meta'))
    .find((meta) => meta.getAttribute(attribute) === key)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.content = content
}

function absoluteUrl(path: string): string {
  try { return new URL(path, SITE.url).toString() } catch { return SITE.url }
}

/** Updates metadata for client-routed public pages. */
export function SeoHead({
  title,
  description,
  noIndex = false,
  image = '/catalog/organic-ingredients.webp',
  type = 'website',
  structuredData,
}: SeoHeadProps) {
  const { pathname } = useLocation()

  useEffect(() => {
    const canonicalUrl = absoluteUrl(pathname)
    const imageUrl = absoluteUrl(image)
    document.title = title
    ensureMeta('name', 'description', description)
    ensureMeta('name', 'robots', noIndex ? 'noindex, nofollow' : 'index, follow')
    ensureMeta('property', 'og:type', type === 'product' ? 'product' : 'website')
    ensureMeta('property', 'og:title', title)
    ensureMeta('property', 'og:description', description)
    ensureMeta('property', 'og:url', canonicalUrl)
    ensureMeta('property', 'og:image', imageUrl)
    ensureMeta('name', 'twitter:card', 'summary_large_image')
    ensureMeta('name', 'twitter:title', title)
    ensureMeta('name', 'twitter:description', description)
    ensureMeta('name', 'twitter:image', imageUrl)

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = canonicalUrl

    let schema = document.getElementById('route-structured-data') as HTMLScriptElement | null
    if (structuredData) {
      if (!schema) {
        schema = document.createElement('script')
        schema.id = 'route-structured-data'
        schema.type = 'application/ld+json'
        document.head.appendChild(schema)
      }
      schema.textContent = JSON.stringify(structuredData).replace(/</g, '\\u003c')
    } else {
      schema?.remove()
    }
  }, [pathname, title, description, noIndex, image, type, structuredData])

  return null
}
