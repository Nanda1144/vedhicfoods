import { CONTACT_TOPICS, FAQS, REVIEWS, SUPPORT_CATEGORIES, TESTIMONIALS } from '@/data/content'
import type { FaqItem, Review, Testimonial } from '@/types'
import { mockRequest, apiFetch, type RequestOptions } from './http'

/**
 * Editorial content (testimonials, FAQs, product reviews).
 *
 * Served from the backend CMS (`GET /content/testimonials`, `/content/faqs`,
 * `/content/reviews`) which staff curate from the admin console. The local
 * `@/data/content` copy is retained strictly as an offline/seeded fallback and
 * is only used when a caller explicitly passes `skipApi`.
 *
 * `supportCategories` and `contactTopics` have no backend endpoint; they remain
 * local enumerations shared with the contact form.
 */
export const contentService = {
  async testimonials(options?: RequestOptions): Promise<Testimonial[]> {
    if (options?.skipApi) return mockRequest(() => TESTIMONIALS, options)
    return apiFetch<Testimonial[]>('/content/testimonials', undefined, options)
  },

  async faqs(options?: RequestOptions): Promise<FaqItem[]> {
    if (options?.skipApi) return mockRequest(() => FAQS, options)
    return apiFetch<FaqItem[]>('/content/faqs', undefined, options)
  },

  async supportCategories(options?: RequestOptions) {
    return mockRequest(() => [...SUPPORT_CATEGORIES], options)
  },

  async contactTopics(options?: RequestOptions) {
    return mockRequest(() => [...CONTACT_TOPICS], options)
  },

  async reviewsFor(productId: string, options?: RequestOptions): Promise<Review[]> {
    if (options?.skipApi) {
      return mockRequest(() => REVIEWS.filter((r) => r.productId === productId), {
        delay: 200,
        ...options,
      })
    }
    return apiFetch<Review[]>(`/content/reviews?productId=${encodeURIComponent(productId)}`, undefined, options)
  },
}

export interface ContactInput {
  name: string
  email: string
  phone: string
  topic: string
  message: string
  /**
   * Honeypot field. Must stay empty; a value proves an automated client and the
   * backend silently discards the submission.
   */
  website?: string
}

/**
 * Maps the storefront's free-text topic onto the backend's `category` enum.
 *
 * The API validates with `z.enum`, so an unmapped topic would be rejected with a
 * 400 and the customer's message would be lost. Unknown values fall through to
 * `GENERAL` rather than failing the submission.
 */
function toContactCategory(topic: string): string {
  const t = topic.trim().toLowerCase()
  if (t.includes('order')) return 'ORDER_ENQUIRY'
  if (t.includes('deliver') || t.includes('shipping')) return 'DELIVERY_ISSUE'
  if (t.includes('return') || t.includes('refund')) return 'RETURN_REFUND'
  if (t.includes('wholesale') || t.includes('bulk')) return 'WHOLESALE'
  if (t.includes('complaint')) return 'COMPLAINT'
  if (t.includes('feedback')) return 'FEEDBACK'
  if (t.includes('product')) return 'PRODUCT_QUESTION'
  return 'GENERAL'
}

export const contactService = {
  /**
   * Posts to `POST /api/v1/contact`, which persists the submission and returns a
   * reference the customer can quote.
   *
   * This previously returned a randomly generated ticket ID and threw the
   * message away, so every contact-form enquiry since the prototype was created
   * was silently lost while the UI reported success.
   */
  async submit(input: ContactInput, options?: RequestOptions): Promise<{ ticketId: string }> {
    if (options?.skipApi) {
      return mockRequest(() => ({ ticketId: `VF-${Math.floor(100000 + Math.random() * 899999)}` }), {
        delay: 800,
        ...options,
      })
    }

    const res = await apiFetch<{ reference?: string }>(
      '/contact',
      {
        method: 'POST',
        // apiFetch takes a standard RequestInit, so the body must be serialised
        // here - passing an object would be a type error and, at runtime, would
        // reach fetch as the literal string "[object Object]".
        body: JSON.stringify({
          name: input.name,
          email: input.email,
          phone: input.phone || undefined,
          // The API requires a subject of at least 5 characters; the topic is the
          // only thing the storefront collects at this point.
          subject: input.topic?.trim() || 'Website enquiry',
          category: toContactCategory(input.topic ?? ''),
          message: input.message,
          ...(input.website ? { website: input.website } : {}),
        }),
      },
      options,
    )

    return { ticketId: res?.reference ?? '' }
  },
}

export interface NewsletterResult {
  ok: true
  email: string
}

export const newsletterService = {
  /**
   * Posts to the public `POST /content/newsletter` endpoint (rate-limited to
   * 10/hour/IP). The API is idempotent: an already-subscribed address returns
   * success without creating a duplicate.
   */
  async subscribe(email: string, options?: RequestOptions): Promise<NewsletterResult> {
    if (options?.skipApi) {
      return mockRequest(() => ({ ok: true as const, email }), { delay: 640, ...options })
    }
    await apiFetch<{ email: string }>(
      '/content/newsletter',
      { method: 'POST', body: JSON.stringify({ email, source: 'footer' }) },
      options,
    )
    return { ok: true, email }
  },
}
